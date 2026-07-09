/**
 * Square payment.completed webhook — bin-debit tests (Milestone D1–D3).
 *
 * Characterizes the packaged-bin-debit path of the webhook handler:
 *   D1 — resolve the Square location to a POS bin (bins.square_location_id) and
 *        pick the FIFO finished good physically in that bin;
 *   D2 — debit the bin via the atomic debit_bin_inventory RPC while STILL
 *        recording the full-quantity taproom_sale allocation (audit/TTB ledger);
 *   D3 — an oversell (RPC clamped=true) does not fail the sale; the line is
 *        surfaced in the response and durably in square_sync_log.details.
 *
 * Also pins the invariants the milestone must not break: race-safe event_id
 * dedup (duplicate = no side effects), unmapped-location flagging, and draft
 * (keg) staging into square_draft_sales with the bin's MGR location_id.
 *
 * Mirrors the repo mock idiom (src/app/api/square/sync/__tests__/sync-routes.test.ts):
 * a small in-memory chainable admin builder + module-level vi.mock. Signature
 * verification and the replay window are stubbed to pass so the handler body is
 * exercised directly.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

// -----------------------------------------------------------------------------
// Mocks (must precede route imports)
// -----------------------------------------------------------------------------

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/integrations/square/client", () => ({
  getSquareClient: vi.fn(),
  getSquareSettings: vi.fn(),
}));

vi.mock("@/integrations/square/webhook", () => ({
  verifyWebhookSignature: vi.fn().mockReturnValue(true),
  checkReplayWindow: vi.fn().mockReturnValue({ ok: true }),
}));

import { createAdminClient } from "@/lib/supabase/server";
import { getSquareClient, getSquareSettings } from "@/integrations/square/client";

import { POST } from "@/app/api/square/webhook/route";

const mockedCreateAdminClient = vi.mocked(createAdminClient);
const mockedGetSquareClient = vi.mocked(getSquareClient);
const mockedGetSquareSettings = vi.mocked(getSquareSettings);

// -----------------------------------------------------------------------------
// In-memory admin builder
// -----------------------------------------------------------------------------

type QueryResult = { data: unknown; error: unknown };
type TableData = Record<string, QueryResult>;

/** Every write the handler performs, in order, tagged by table + op. */
const writes: Array<{ table: string; op: "insert" | "upsert" | "update"; row: unknown }> = [];
/** Every debit_bin_inventory RPC call, in order. */
const rpcCalls: Array<{ fn: string; args: unknown }> = [];
/** Configurable RPC response (default: normal debit, no clamp). */
let rpcResponse: QueryResult = { data: [{ new_quantity: 5, clamped: false }], error: null };

function makeAdmin(tables: TableData) {
  return {
    from(table: string) {
      const result: QueryResult = tables[table] ?? { data: [], error: null };
      const builder = {
        select: () => builder,
        eq: () => builder,
        gt: () => builder,
        order: () => builder,
        limit: () => builder,
        delete: () => builder,
        upsert: (row: unknown) => {
          writes.push({ table, op: "upsert", row });
          return builder;
        },
        insert: (row: unknown) => {
          writes.push({ table, op: "insert", row });
          return builder;
        },
        update: (row: unknown) => {
          writes.push({ table, op: "update", row });
          return builder;
        },
        maybeSingle: () => Promise.resolve(result),
        single: () => Promise.resolve(result),
        then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
          Promise.resolve(result).then(onF, onR),
      };
      return builder;
    },
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve(rpcResponse);
    },
  };
}

function useTables(tables: TableData) {
  mockedCreateAdminClient.mockImplementation(
    async () => makeAdmin(tables) as unknown as Awaited<ReturnType<typeof createAdminClient>>
  );
}

type LineItem = {
  catalogObjectId?: string;
  quantity: string;
  uid?: string;
  basePriceMoney?: { amount: number };
};

function useOrder(lineItems: LineItem[]) {
  mockedGetSquareClient.mockResolvedValue({
    orders: { get: vi.fn().mockResolvedValue({ order: { lineItems } }) },
  } as never);
}

const EVENT = {
  merchant_id: "MERCHANT-1",
  type: "payment.completed",
  event_id: "evt-1",
  created_at: new Date().toISOString(),
  data: {
    type: "payment",
    id: "obj-1",
    object: {
      payment: { id: "pay-1", order_id: "order-1", location_id: "SQ-LOC-1" },
    },
  },
};

function post(event: unknown) {
  return POST(
    new NextRequest("http://localhost/api/square/webhook", {
      method: "POST",
      headers: { "x-square-hmacsha256-signature": "sig" },
      body: JSON.stringify(event),
    })
  );
}

// Common table fixtures ------------------------------------------------------

const CLAIM_OK: QueryResult = { data: [{ id: "log-1" }], error: null };
const CLAIM_DUP: QueryResult = { data: [], error: null };
const BIN_SQ_LOC_1: QueryResult = {
  data: { id: "bin-1", location_id: "loc-1", pos_sales_channel_id: "chan-A" },
  error: null,
};
const MAP_PACKAGED: QueryResult = {
  data: {
    id: "map-1",
    brand_id: "brand-1",
    selling_format_id: "fmt-1",
    selling_formats: { containers: { type: "can" } },
  },
  error: null,
};
const MAP_KEG: QueryResult = {
  data: {
    id: "map-2",
    brand_id: "brand-1",
    selling_format_id: "fmt-1",
    selling_formats: { containers: { type: "keg" } },
  },
  error: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  writes.length = 0;
  rpcCalls.length = 0;
  rpcResponse = { data: [{ new_quantity: 5, clamped: false }], error: null };
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost";
  mockedGetSquareSettings.mockResolvedValue({ webhookSignatureKey: "k" } as never);
  useOrder([
    { catalogObjectId: "CAT-1", quantity: "3", uid: "line-1", basePriceMoney: { amount: 500 } },
  ]);
});

// =============================================================================
// Tests
// =============================================================================

describe("payment.completed — packaged bin debit (D1–D3)", () => {
  it("debits the mapped bin's FIFO finished good by qty AND records the taproom_sale allocation", async () => {
    useTables({
      square_sync_log: CLAIM_OK,
      bins: BIN_SQ_LOC_1,
      square_catalog_map: MAP_PACKAGED,
      bin_inventory: { data: { finished_good_id: "fg-1", quantity: 10 }, error: null },
      allocations: { data: null, error: null },
    });

    const res = await post(EVENT);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });

    // D2: debit RPC called with the resolved bin, FIFO FG, and sold qty.
    expect(rpcCalls).toEqual([
      { fn: "debit_bin_inventory", args: { p_bin_id: "bin-1", p_finished_good_id: "fg-1", p_qty: 3 } },
    ]);

    // Allocation (audit/TTB) records the FIFO FG as source, full sold qty.
    const alloc = writes.find((w) => w.table === "allocations")!.row as {
      source_type: string;
      source_id: string;
      destination_type: string;
      quantity: number;
    };
    expect(alloc).toMatchObject({
      source_type: "finished_good",
      source_id: "fg-1",
      destination_type: "taproom_sale",
      quantity: 3,
    });

    // Finalize log: one synced, none failed, bin's location recorded.
    const finalize = writes.find((w) => w.table === "square_sync_log" && w.op === "update")!.row as {
      items_synced: number;
      items_failed: number;
      location_id: string | null;
    };
    expect(finalize.items_synced).toBe(1);
    expect(finalize.items_failed).toBe(0);
    expect(finalize.location_id).toBe("loc-1");
  });

  it("oversell: RPC clamped=true surfaces the line in the response AND the sync log, sale still counts", async () => {
    rpcResponse = { data: [{ new_quantity: 0, clamped: true }], error: null };
    useTables({
      square_sync_log: CLAIM_OK,
      bins: BIN_SQ_LOC_1,
      square_catalog_map: MAP_PACKAGED,
      bin_inventory: { data: { finished_good_id: "fg-1", quantity: 2 }, error: null },
      allocations: { data: null, error: null },
    });

    const res = await post(EVENT);
    expect(res.status).toBe(200);

    const expectedLine = {
      lineItemUid: "line-1",
      brandId: "brand-1",
      sellingFormatId: "fmt-1",
      soldQty: 3,
      binQuantityBefore: 2,
    };

    // Response surfaces the oversold line.
    const body = await res.json();
    expect(body).toEqual({ received: true, oversoldLines: [expectedLine] });

    // Durable in the sync log details.
    const finalize = writes.find((w) => w.table === "square_sync_log" && w.op === "update")!.row as {
      items_synced: number;
      items_failed: number;
      details: { oversoldLines?: unknown[] };
    };
    expect(finalize.details.oversoldLines).toEqual([expectedLine]);

    // Sale still succeeded: synced, not failed. Allocation + debit both happened.
    expect(finalize.items_synced).toBe(1);
    expect(finalize.items_failed).toBe(0);
    expect(writes.some((w) => w.table === "allocations")).toBe(true);
    expect(rpcCalls).toHaveLength(1);
  });

  it("Square retry (duplicate event_id): dedup claim returns [] → no allocation, no debit", async () => {
    useTables({
      square_sync_log: CLAIM_DUP,
      bins: BIN_SQ_LOC_1,
      square_catalog_map: MAP_PACKAGED,
      bin_inventory: { data: { finished_good_id: "fg-1", quantity: 10 }, error: null },
      allocations: { data: null, error: null },
    });

    const res = await post(EVENT);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });

    // Deduped before any side effect: no allocation insert, no RPC, no finalize.
    expect(writes.some((w) => w.table === "allocations")).toBe(false);
    expect(rpcCalls).toHaveLength(0);
    expect(writes.some((w) => w.table === "square_sync_log" && w.op === "update")).toBe(false);
  });

  it("unmapped Square location: bins lookup null → packaged line flagged, no debit, no allocation", async () => {
    useTables({
      square_sync_log: CLAIM_OK,
      bins: { data: null, error: null },
      square_catalog_map: MAP_PACKAGED,
      bin_inventory: { data: { finished_good_id: "fg-1", quantity: 10 }, error: null },
      allocations: { data: null, error: null },
    });

    const res = await post(EVENT);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });

    // No debit, no allocation for the unmapped line.
    expect(rpcCalls).toHaveLength(0);
    expect(writes.some((w) => w.table === "allocations")).toBe(false);

    // Flagged as failed with a bin-oriented error surfaced in the log.
    const finalize = writes.find((w) => w.table === "square_sync_log" && w.op === "update")!.row as {
      items_synced: number;
      items_failed: number;
      details: { errors?: Array<{ error: string }> };
    };
    expect(finalize.items_synced).toBe(0);
    expect(finalize.items_failed).toBe(1);
    expect(finalize.details.errors?.[0].error).toContain("not mapped to a POS bin");
  });

  it("draft (keg) line still staged into square_draft_sales with the bin's location_id", async () => {
    useTables({
      square_sync_log: CLAIM_OK,
      bins: BIN_SQ_LOC_1,
      square_catalog_map: MAP_KEG,
      square_draft_sales: { data: null, error: null },
    });

    const res = await post(EVENT);
    expect(res.status).toBe(200);

    // Kegs are staged, not debited.
    expect(rpcCalls).toHaveLength(0);
    expect(writes.some((w) => w.table === "allocations")).toBe(false);

    const draft = writes.find((w) => w.table === "square_draft_sales")!.row as {
      location_id: string | null;
      brand_id: string;
      selling_format_id: string;
      quantity: number;
    };
    expect(draft).toMatchObject({
      location_id: "loc-1",
      brand_id: "brand-1",
      selling_format_id: "fmt-1",
      quantity: 3,
    });
  });
});
