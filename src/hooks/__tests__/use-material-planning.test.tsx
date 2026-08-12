// @vitest-environment jsdom

/**
 * Characterization tests for the material-planning hooks (backend-extraction
 * T3.1, `docs/plans/backend-extraction.md`).
 *
 * `useSessionMaterialPreview` carries the only copy of the *planned*-quantity
 * BOM rollup: whole-unit ratio recovery, per-batch ceiling, on-hand flooring,
 * shortfall and sort order. These tests were written against the pre-extraction
 * hook and MUST keep passing verbatim after the math moves to
 * `src/domain/material-planning.ts` and the reads move to
 * `src/services/material-planning-service.ts` — they are the proof the split
 * changed no behavior.
 *
 * They pin, in particular, the two whole-unit rules that are easy to lose:
 * ratio recovery (240 cans x a stored `0.0417` is 10 trays, not 11) and the
 * PER-BATCH ceiling (M8 — two batches of 12 need two trays, not one).
 */

import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupRenderHarness } from "@/test/react-harness";
import { materialPlanningKeys } from "@/lib/query-keys";

// ---------------------------------------------------------------------------
// Supabase stub: routes `.from(table)` to a per-table canned response, and
// records the `.select()` string / filters each hook issued.
// ---------------------------------------------------------------------------

type TableResponse = { data: unknown; error: unknown };

const tableResponses = new Map<string, TableResponse>();
const rpcResponses = new Map<string, TableResponse>();
const calls: Array<{ table: string; select?: string; filters: unknown[] }> = [];
const rpcCalls: Array<{ fn: string; args: unknown }> = [];

function tableChain(table: string) {
  const record = { table, select: undefined as string | undefined, filters: [] as unknown[] };
  calls.push(record);
  const chain: Record<string, unknown> = {};
  chain.select = (s: string) => {
    record.select = s;
    return chain;
  };
  chain.eq = (col: string, val: unknown) => {
    record.filters.push({ op: "eq", col, val });
    return chain;
  };
  chain.in = (col: string, val: unknown) => {
    record.filters.push({ op: "in", col, val });
    return chain;
  };
  chain.then = (
    onFulfilled?: (value: TableResponse) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) =>
    Promise.resolve(
      tableResponses.get(table) ?? { data: [], error: null },
    ).then(onFulfilled, onRejected);
  return chain;
}

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => tableChain(table),
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return {
        then: (
          onFulfilled?: (value: TableResponse) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) =>
          Promise.resolve(
            rpcResponses.get(fn) ?? { data: [], error: null },
          ).then(onFulfilled, onRejected),
      };
    },
  }),
}));

import {
  useSellingFormatBOM,
  useMaterialShortfalls,
  useOrderMaterials,
  useSessionMaterialPreview,
} from "@/hooks/use-material-planning";

const { render } = setupRenderHarness();

/**
 * Mounts `hook` under a fresh QueryClient and resolves once the query settles.
 * Returns the final react-query result so assertions can read `data`/`error`.
 */
async function mountHook<T>(hook: () => T): Promise<T> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  let latest: T | null = null;
  const publish = (value: T) => {
    latest = value;
  };
  function Probe() {
    publish(hook());
    return null;
  }
  await act(async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>,
    );
  });
  // Drain the queryFn: each pass yields a macrotask so the awaits inside the
  // queryFn (up to three sequential Supabase reads) resolve and re-render.
  // `isFetching()` is still 0 on the pass right after mount — the observer has
  // not kicked the fetch off yet — so always take a few passes before trusting
  // it, or a disabled-looking early exit would return the pending first render.
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    if (i >= 2 && queryClient.isFetching() === 0) break;
  }
  return latest as T;
}

const ITEM = (over: Record<string, unknown> = {}) => ({
  id: "tray",
  name: "Tray",
  sku: "TRY",
  category: "packaging",
  unit: "each",
  ...over,
});

beforeEach(() => {
  tableResponses.clear();
  rpcResponses.clear();
  calls.length = 0;
  rpcCalls.length = 0;
});

// ---------------------------------------------------------------------------

describe("useSellingFormatBOM", () => {
  it("is disabled without a selling format id and issues no query", async () => {
    const r = await mountHook(() => useSellingFormatBOM(null));
    expect((r as { fetchStatus: string }).fetchStatus).toBe("idle");
    expect(calls).toHaveLength(0);
  });

  it("selects the joined inventory_item shape filtered by selling_format_id", async () => {
    tableResponses.set("selling_format_materials", {
      data: [
        {
          id: "bom-1",
          selling_format_id: "fmt-1",
          inventory_item_id: "tray",
          quantity_per_unit: 0.0417,
          notes: null,
          inventory_item: ITEM(),
        },
      ],
      error: null,
    });
    const r = await mountHook(() => useSellingFormatBOM("fmt-1"));
    expect(r.data).toHaveLength(1);
    expect(r.data?.[0].quantity_per_unit).toBe(0.0417);
    expect(calls[0].table).toBe("selling_format_materials");
    expect(calls[0].select).toContain("inventory_item:inventory_items");
    expect(calls[0].filters).toEqual([
      { op: "eq", col: "selling_format_id", val: "fmt-1" },
    ]);
  });

  it("returns [] when the table yields null", async () => {
    tableResponses.set("selling_format_materials", { data: null, error: null });
    const r = await mountHook(() => useSellingFormatBOM("fmt-1"));
    expect(r.data).toEqual([]);
  });
});

describe("useMaterialShortfalls", () => {
  const rows = [
    { inventory_item_id: "a", demand_source: "order", shortfall: 5 },
    { inventory_item_id: "b", demand_source: "session", shortfall: 2 },
  ];

  it("defaults the horizon to 4 weeks", async () => {
    rpcResponses.set("calculate_material_shortfalls", { data: rows, error: null });
    await mountHook(() => useMaterialShortfalls());
    expect(rpcCalls[0]).toEqual({
      fn: "calculate_material_shortfalls",
      args: { p_horizon_weeks: 4 },
    });
  });

  it("passes an explicit horizon through", async () => {
    rpcResponses.set("calculate_material_shortfalls", { data: rows, error: null });
    await mountHook(() => useMaterialShortfalls({ horizonWeeks: 12 }));
    expect(rpcCalls[0].args).toEqual({ p_horizon_weeks: 12 });
  });

  it("filters by demandSource client-side without changing the cache key", async () => {
    rpcResponses.set("calculate_material_shortfalls", { data: rows, error: null });
    const r = await mountHook(() => useMaterialShortfalls({ demandSource: "order" }));
    expect(r.data?.map((x) => x.inventory_item_id)).toEqual(["a"]);
    // demandSource is deliberately absent from the key — all source variants
    // share one RPC response per horizon.
    expect(materialPlanningKeys.shortfalls({ horizonWeeks: undefined })).toEqual([
      "material-planning",
      "shortfalls",
      { horizonWeeks: undefined },
    ]);
  });

  it('treats demandSource "all" as no filter', async () => {
    rpcResponses.set("calculate_material_shortfalls", { data: rows, error: null });
    const r = await mountHook(() => useMaterialShortfalls({ demandSource: "all" }));
    expect(r.data).toHaveLength(2);
  });
});

describe("useOrderMaterials", () => {
  it("is disabled without an order id", async () => {
    const r = await mountHook(() => useOrderMaterials(null));
    expect((r as { fetchStatus: string }).fetchStatus).toBe("idle");
    expect(calls).toHaveLength(0);
  });

  it("fetches order_materials joined to inventory_item for the order", async () => {
    tableResponses.set("order_materials", {
      data: [
        {
          id: "om-1",
          order_id: "ord-1",
          inventory_item_id: "tray",
          estimated_qty: 10,
          actual_qty: null,
          inventory_item: ITEM(),
        },
      ],
      error: null,
    });
    const r = await mountHook(() => useOrderMaterials("ord-1"));
    expect(r.data?.[0].estimated_qty).toBe(10);
    expect(r.data?.[0].actual_qty).toBeNull();
    expect(calls[0].table).toBe("order_materials");
    expect(calls[0].filters).toEqual([{ op: "eq", col: "order_id", val: "ord-1" }]);
  });
});

describe("useSessionMaterialPreview", () => {
  /** Seed the three tables the preview reads, in one call. */
  function seed(opts: {
    lineItems: unknown[];
    bom?: unknown[];
    onHand?: unknown[];
  }) {
    tableResponses.set("session_line_items", { data: opts.lineItems, error: null });
    tableResponses.set("selling_format_materials", { data: opts.bom ?? [], error: null });
    tableResponses.set("inventory_lots_with_quantities", {
      data: opts.onHand ?? [],
      error: null,
    });
  }

  const bomLine = (over: Record<string, unknown> = {}) => ({
    selling_format_id: "fmt-can",
    inventory_item_id: "tray",
    quantity_per_unit: 0.0417,
    inventory_item: ITEM(),
    ...over,
  });

  it("is disabled without a session id", async () => {
    const r = await mountHook(() => useSessionMaterialPreview(null));
    expect((r as { fetchStatus: string }).fetchStatus).toBe("idle");
    expect(calls).toHaveLength(0);
  });

  it("returns [] with no line items, and never reads the BOM", async () => {
    seed({ lineItems: [] });
    const r = await mountHook(() => useSessionMaterialPreview("s1"));
    expect(r.data).toEqual([]);
    expect(calls.map((c) => c.table)).toEqual(["session_line_items"]);
  });

  it("returns [] when no line item carries a selling format", async () => {
    seed({
      lineItems: [{ selling_format_id: null, planned_quantity: 100, batch_id: "b1" }],
    });
    const r = await mountHook(() => useSessionMaterialPreview("s1"));
    expect(r.data).toEqual([]);
    expect(calls.map((c) => c.table)).toEqual(["session_line_items"]);
  });

  it("returns [] when the formats have no BOM rows", async () => {
    seed({
      lineItems: [{ selling_format_id: "fmt-can", planned_quantity: 100, batch_id: "b1" }],
      bom: [],
    });
    const r = await mountHook(() => useSessionMaterialPreview("s1"));
    expect(r.data).toEqual([]);
    // on-hand is never read when nothing aggregated.
    expect(calls.map((c) => c.table)).toEqual([
      "session_line_items",
      "selling_format_materials",
    ]);
  });

  it("recovers the exact 1/24 ratio behind a stored 0.0417 (240 cans -> 10 trays, not 11)", async () => {
    seed({
      lineItems: [{ selling_format_id: "fmt-can", planned_quantity: 240, batch_id: "b1" }],
      bom: [bomLine()],
    });
    const r = await mountHook(() => useSessionMaterialPreview("s1"));
    expect(r.data?.[0].total_required).toBe(10);
    expect(r.data?.[0].is_whole_unit).toBe(true);
  });

  it("ceils whole-unit needs PER BATCH before summing (M8)", async () => {
    // Two batches of 12 cans each: one tray apiece, NOT ceil(24/24) === 1.
    seed({
      lineItems: [
        { selling_format_id: "fmt-can", planned_quantity: 12, batch_id: "b1" },
        { selling_format_id: "fmt-can", planned_quantity: 12, batch_id: "b2" },
      ],
      bom: [bomLine()],
    });
    const r = await mountHook(() => useSessionMaterialPreview("s1"));
    expect(r.data?.[0].total_required).toBe(2);
  });

  it("sums line items within one batch before ceiling", async () => {
    seed({
      lineItems: [
        { selling_format_id: "fmt-can", planned_quantity: 12, batch_id: "b1" },
        { selling_format_id: "fmt-can", planned_quantity: 12, batch_id: "b1" },
      ],
      bom: [bomLine()],
    });
    const r = await mountHook(() => useSessionMaterialPreview("s1"));
    expect(r.data?.[0].total_required).toBe(1);
  });

  it("groups null batch_id into its own bucket", async () => {
    seed({
      lineItems: [
        { selling_format_id: "fmt-can", planned_quantity: 12, batch_id: null },
        { selling_format_id: "fmt-can", planned_quantity: 12, batch_id: null },
      ],
      bom: [bomLine()],
    });
    const r = await mountHook(() => useSessionMaterialPreview("s1"));
    // Both fall in the "nobatch" bucket, so they sum to 24 then ceil to 1.
    expect(r.data?.[0].total_required).toBe(1);
  });

  it("keeps decimal precision for bulk (non-whole) units", async () => {
    seed({
      lineItems: [{ selling_format_id: "fmt-can", planned_quantity: 10, batch_id: "b1" }],
      bom: [
        bomLine({
          inventory_item_id: "glue",
          quantity_per_unit: 0.25,
          inventory_item: ITEM({ id: "glue", name: "Glue", unit: "gal" }),
        }),
      ],
    });
    const r = await mountHook(() => useSessionMaterialPreview("s1"));
    expect(r.data?.[0].total_required).toBe(2.5);
    expect(r.data?.[0].is_whole_unit).toBe(false);
  });

  it("skips line items with a null planned_quantity", async () => {
    seed({
      lineItems: [
        { selling_format_id: "fmt-can", planned_quantity: null, batch_id: "b1" },
        { selling_format_id: "fmt-can", planned_quantity: 24, batch_id: "b1" },
      ],
      bom: [bomLine()],
    });
    const r = await mountHook(() => useSessionMaterialPreview("s1"));
    expect(r.data?.[0].total_required).toBe(1);
  });

  it("floors whole-unit on-hand and sums it across lots", async () => {
    seed({
      lineItems: [{ selling_format_id: "fmt-can", planned_quantity: 240, batch_id: "b1" }],
      bom: [bomLine()],
      onHand: [
        { inventory_item_id: "tray", remaining_quantity: 2.4 },
        { inventory_item_id: "tray", remaining_quantity: 1.4 },
      ],
    });
    const r = await mountHook(() => useSessionMaterialPreview("s1"));
    // 2.4 + 1.4 = 3.8, floored to 3 because trays are whole units.
    expect(r.data?.[0].on_hand_quantity).toBe(3);
    expect(r.data?.[0].shortfall).toBe(7);
  });

  it("does not floor bulk on-hand", async () => {
    seed({
      lineItems: [{ selling_format_id: "fmt-can", planned_quantity: 10, batch_id: "b1" }],
      bom: [
        bomLine({
          inventory_item_id: "glue",
          quantity_per_unit: 0.25,
          inventory_item: ITEM({ id: "glue", name: "Glue", unit: "gal" }),
        }),
      ],
      onHand: [{ inventory_item_id: "glue", remaining_quantity: 1.75 }],
    });
    const r = await mountHook(() => useSessionMaterialPreview("s1"));
    expect(r.data?.[0].on_hand_quantity).toBe(1.75);
    expect(r.data?.[0].shortfall).toBeCloseTo(0.75, 10);
  });

  it("clamps shortfall at zero when on-hand covers the need", async () => {
    seed({
      lineItems: [{ selling_format_id: "fmt-can", planned_quantity: 24, batch_id: "b1" }],
      bom: [bomLine()],
      onHand: [{ inventory_item_id: "tray", remaining_quantity: 99 }],
    });
    const r = await mountHook(() => useSessionMaterialPreview("s1"));
    expect(r.data?.[0].shortfall).toBe(0);
  });

  it("sorts rows by shortfall descending", async () => {
    seed({
      lineItems: [{ selling_format_id: "fmt-can", planned_quantity: 24, batch_id: "b1" }],
      bom: [
        bomLine({ inventory_item_id: "tray", quantity_per_unit: 1 }),
        bomLine({
          inventory_item_id: "lid",
          quantity_per_unit: 2,
          inventory_item: ITEM({ id: "lid", name: "Lid" }),
        }),
      ],
      onHand: [],
    });
    const r = await mountHook(() => useSessionMaterialPreview("s1"));
    expect(r.data?.map((x) => x.inventory_item_id)).toEqual(["lid", "tray"]);
    expect(r.data?.map((x) => x.shortfall)).toEqual([48, 24]);
  });

  it("carries inventory_item display fields through, falling back to the id for a missing name", async () => {
    seed({
      lineItems: [{ selling_format_id: "fmt-can", planned_quantity: 24, batch_id: "b1" }],
      bom: [bomLine({ quantity_per_unit: 1, inventory_item: null })],
    });
    const r = await mountHook(() => useSessionMaterialPreview("s1"));
    expect(r.data?.[0]).toMatchObject({
      inventory_item_id: "tray",
      inventory_item_name: "tray",
      sku: null,
      category: null,
      unit: null,
      is_whole_unit: false,
    });
  });

  it("de-duplicates the selling format ids it looks the BOM up by", async () => {
    seed({
      lineItems: [
        { selling_format_id: "fmt-can", planned_quantity: 24, batch_id: "b1" },
        { selling_format_id: "fmt-can", planned_quantity: 24, batch_id: "b2" },
      ],
      bom: [bomLine()],
    });
    await mountHook(() => useSessionMaterialPreview("s1"));
    const bomCall = calls.find((c) => c.table === "selling_format_materials")!;
    expect(bomCall.filters).toEqual([
      { op: "in", col: "selling_format_id", val: ["fmt-can"] },
    ]);
  });

  it("surfaces a line-items read error", async () => {
    tableResponses.set("session_line_items", {
      data: null,
      error: { message: "line boom" },
    });
    const r = await mountHook(() => useSessionMaterialPreview("s1"));
    expect((r.error as { message: string }).message).toBe("line boom");
  });

  it("surfaces a BOM read error", async () => {
    seed({
      lineItems: [{ selling_format_id: "fmt-can", planned_quantity: 24, batch_id: "b1" }],
    });
    tableResponses.set("selling_format_materials", {
      data: null,
      error: { message: "bom boom" },
    });
    const r = await mountHook(() => useSessionMaterialPreview("s1"));
    expect((r.error as { message: string }).message).toBe("bom boom");
  });

  it("surfaces an on-hand read error", async () => {
    seed({
      lineItems: [{ selling_format_id: "fmt-can", planned_quantity: 24, batch_id: "b1" }],
      bom: [bomLine()],
    });
    tableResponses.set("inventory_lots_with_quantities", {
      data: null,
      error: { message: "onhand boom" },
    });
    const r = await mountHook(() => useSessionMaterialPreview("s1"));
    expect((r.error as { message: string }).message).toBe("onhand boom");
  });
});
