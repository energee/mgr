/**
 * Square payment webhook — bin-debit tests (Milestone D1–D3).
 *
 * Square does NOT emit a "payment.completed" event: a payment's lifecycle is
 * delivered via payment.created / payment.updated whose `status` transitions to
 * "COMPLETED". Both route to handleCompletedPayment. Because BOTH deliveries can
 * arrive already-COMPLETED for the same sale, dedup keys on the Square PAYMENT
 * id (not the event id) so a sale debits inventory exactly once.
 *
 * Characterizes the packaged-bin-debit path of the webhook handler:
 *   D1 — resolve the Square location to a POS bin (bins.square_location_id) and
 *        fetch every finished-good lot physically in that bin;
 *   D2 — draw the sold quantity FIFO across those lots (oldest production_date
 *        first), recording one taproom_sale allocation (with volume_bbl for TTB)
 *        AND one debit_bin_inventory RPC per lot drawn;
 *   D3 — a shortfall (bin cannot cover the sale) does not fail the sale; only
 *        what physically existed is allocated, and the shortfall is surfaced in
 *        the response and durably in square_sync_log.details.
 *
 * Also pins the invariants the milestone must not break: race-safe
 * payment-id dedup (duplicate = no side effects), a transient dedup-claim DB
 * error surfacing as 500 (not a silent skip), non-COMPLETED payments ignored,
 * unmapped-location flagging, a debit RPC error marking the line FAILED, and
 * draft (keg) staging into square_draft_sales with the bin's MGR location_id.
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
type AdminOpts = {
  /**
   * Successive results for square_sync_log UPSERTs (the dedup claim), consumed
   * in order across POST calls — simulates the UNIQUE(square_payment_id)
   * constraint: first delivery claims (CLAIM_OK), the retry gets CLAIM_DUP.
   */
  claimQueue?: QueryResult[];
};

/** Every write the handler performs, in order, tagged by table + op. */
const writes: Array<{ table: string; op: "insert" | "upsert" | "update"; row: unknown }> = [];
/** Every debit_bin_inventory RPC call, in order. */
const rpcCalls: Array<{ fn: string; args: unknown }> = [];
/** Configurable RPC response (default: normal debit, no clamp). */
let rpcResponse: QueryResult = { data: [{ new_quantity: 5, clamped: false }], error: null };

function makeAdmin(tables: TableData, opts: AdminOpts = {}) {
  return {
    from(table: string) {
      let result: QueryResult = tables[table] ?? { data: [], error: null };
      const builder = {
        select: () => builder,
        eq: () => builder,
        gt: () => builder,
        order: () => builder,
        limit: () => builder,
        delete: () => builder,
        upsert: (row: unknown) => {
          writes.push({ table, op: "upsert", row });
          // The dedup claim: hand out the next queued result if configured.
          if (table === "square_sync_log" && opts.claimQueue && opts.claimQueue.length > 0) {
            result = opts.claimQueue.shift()!;
          }
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

function useTables(tables: TableData, opts: AdminOpts = {}) {
  mockedCreateAdminClient.mockImplementation(
    async () => makeAdmin(tables, opts) as unknown as Awaited<ReturnType<typeof createAdminClient>>
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

/** Base event: payment.updated already COMPLETED (Square's real shape). */
const EVENT = {
  merchant_id: "MERCHANT-1",
  type: "payment.updated",
  event_id: "evt-1",
  created_at: new Date().toISOString(),
  data: {
    type: "payment",
    id: "obj-1",
    object: {
      payment: { id: "pay-1", order_id: "order-1", location_id: "SQ-LOC-1", status: "COMPLETED" },
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
    selling_formats: { unit_count: 1, containers: { type: "can", volume_oz: 16 } },
  },
  error: null,
};
const MAP_KEG: QueryResult = {
  data: {
    id: "map-2",
    brand_id: "brand-1",
    selling_format_id: "fmt-1",
    selling_formats: { unit_count: 1, containers: { type: "keg", volume_oz: null } },
  },
  error: null,
};

/** One bin lot with `quantity` units, dated `date` (drives FIFO order). */
function lot(finished_good_id: string, quantity: number, date: string | null) {
  return { finished_good_id, quantity, finished_goods: { production_date: date } };
}

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

describe("payment.updated — packaged bin debit (D1–D3)", () => {
  it("draws the mapped bin's FIFO finished good by qty, records the taproom_sale allocation with volume_bbl", async () => {
    useTables({
      square_sync_log: CLAIM_OK,
      bins: BIN_SQ_LOC_1,
      square_catalog_map: MAP_PACKAGED,
      bin_inventory: { data: [lot("fg-1", 10, "2024-01-01")], error: null },
      allocations: { data: null, error: null },
    });

    const res = await post(EVENT);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });

    // D2: debit RPC called with the resolved bin, FIFO FG, and sold qty.
    expect(rpcCalls).toEqual([
      { fn: "debit_bin_inventory", args: { p_bin_id: "bin-1", p_finished_good_id: "fg-1", p_qty: 3 } },
    ]);

    // Allocation (audit/TTB) records the FIFO FG as source, full sold qty, and a
    // positive volume_bbl (16 oz / 3968 x 1 unit x 3) so TTB removals report it.
    const alloc = writes.find((w) => w.table === "allocations")!.row as {
      source_type: string;
      source_id: string;
      destination_type: string;
      quantity: number;
      volume_bbl: number | null;
      reason_code: string | null;
    };
    expect(alloc).toMatchObject({
      source_type: "finished_good",
      source_id: "fg-1",
      destination_type: "taproom_sale",
      quantity: 3,
      reason_code: "other",
    });
    expect(alloc.volume_bbl).toBeGreaterThan(0);
    expect(alloc.volume_bbl).toBeCloseTo((16 / 3968) * 3, 6);

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

  it("multi-lot FIFO: draws the oldest lot first, cascades the remainder to the next", async () => {
    // Bin holds two lots of the same brand+format; sold qty (3) spans both.
    // Rows returned out of order to prove the handler sorts by production_date.
    useTables({
      square_sync_log: CLAIM_OK,
      bins: BIN_SQ_LOC_1,
      square_catalog_map: MAP_PACKAGED,
      bin_inventory: {
        data: [lot("fg-new", 5, "2024-06-01"), lot("fg-old", 2, "2024-01-01")],
        error: null,
      },
      allocations: { data: null, error: null },
    });

    const res = await post(EVENT);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });

    // Oldest lot exhausted first (2), then the remainder (1) from the newer lot.
    expect(rpcCalls).toEqual([
      { fn: "debit_bin_inventory", args: { p_bin_id: "bin-1", p_finished_good_id: "fg-old", p_qty: 2 } },
      { fn: "debit_bin_inventory", args: { p_bin_id: "bin-1", p_finished_good_id: "fg-new", p_qty: 1 } },
    ]);

    // One allocation per lot drawn, quantity == draw (never the full sold qty).
    const allocs = writes
      .filter((w) => w.table === "allocations")
      .map((w) => w.row as { source_id: string; quantity: number });
    expect(allocs).toEqual([
      expect.objectContaining({ source_id: "fg-old", quantity: 2 }),
      expect.objectContaining({ source_id: "fg-new", quantity: 1 }),
    ]);

    // Fully covered: synced, no oversell.
    const finalize = writes.find((w) => w.table === "square_sync_log" && w.op === "update")!.row as {
      items_synced: number;
      items_failed: number;
      details: { oversoldLines?: unknown[] };
    };
    expect(finalize.items_synced).toBe(1);
    expect(finalize.items_failed).toBe(0);
    expect(finalize.details.oversoldLines).toBeUndefined();
  });

  it("oversell: bin can't cover the sale — allocates only what existed, surfaces the shortfall, sale still counts", async () => {
    useTables({
      square_sync_log: CLAIM_OK,
      bins: BIN_SQ_LOC_1,
      square_catalog_map: MAP_PACKAGED,
      bin_inventory: { data: [lot("fg-1", 2, "2024-01-01")], error: null },
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
      shortfallQty: 1,
    };

    // Response surfaces the oversold line with the shortfall.
    const body = await res.json();
    expect(body).toEqual({ received: true, oversoldLines: [expectedLine] });

    // Durable in the sync log details.
    const finalize = writes.find((w) => w.table === "square_sync_log" && w.op === "update")!.row as {
      items_synced: number;
      items_failed: number;
      details: { oversoldLines?: unknown[] };
    };
    expect(finalize.details.oversoldLines).toEqual([expectedLine]);

    // Only the 2 that existed were allocated + debited (not the sold 3).
    const alloc = writes.find((w) => w.table === "allocations")!.row as { quantity: number };
    expect(alloc.quantity).toBe(2);
    expect(rpcCalls).toEqual([
      { fn: "debit_bin_inventory", args: { p_bin_id: "bin-1", p_finished_good_id: "fg-1", p_qty: 2 } },
    ]);

    // Sale still succeeded: synced, not failed.
    expect(finalize.items_synced).toBe(1);
    expect(finalize.items_failed).toBe(0);
  });

  it("non-COMPLETED payment (payment.created, status PENDING) is acknowledged and ignored", async () => {
    useTables({
      square_sync_log: CLAIM_OK,
      bins: BIN_SQ_LOC_1,
      square_catalog_map: MAP_PACKAGED,
      bin_inventory: { data: [lot("fg-1", 10, "2024-01-01")], error: null },
      allocations: { data: null, error: null },
    });

    const pending = {
      ...EVENT,
      type: "payment.created",
      event_id: "evt-pending",
      data: {
        ...EVENT.data,
        object: { payment: { id: "pay-1", order_id: "order-1", location_id: "SQ-LOC-1", status: "PENDING" } },
      },
    };

    const res = await post(pending);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });

    // Ignored before any side effect: no claim, no debit, no allocation.
    expect(writes.some((w) => w.table === "square_sync_log")).toBe(false);
    expect(rpcCalls).toHaveLength(0);
    expect(writes.some((w) => w.table === "allocations")).toBe(false);
  });

  it("same sale delivered twice (payment.created then payment.updated, both COMPLETED) debits exactly ONCE", async () => {
    // UNIQUE(square_payment_id) simulated: first claim wins, second gets [].
    useTables(
      {
        square_sync_log: CLAIM_OK,
        bins: BIN_SQ_LOC_1,
        square_catalog_map: MAP_PACKAGED,
        bin_inventory: { data: [lot("fg-1", 10, "2024-01-01")], error: null },
        allocations: { data: null, error: null },
      },
      { claimQueue: [CLAIM_OK, CLAIM_DUP] }
    );

    const created = {
      ...EVENT,
      type: "payment.created",
      event_id: "evt-created",
    };
    const updated = {
      ...EVENT,
      type: "payment.updated",
      event_id: "evt-updated",
    };

    const res1 = await post(created);
    const res2 = await post(updated);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    // Only the first delivery debited; the retry deduped on the payment id.
    expect(rpcCalls).toEqual([
      { fn: "debit_bin_inventory", args: { p_bin_id: "bin-1", p_finished_good_id: "fg-1", p_qty: 3 } },
    ]);
    expect(writes.filter((w) => w.table === "allocations")).toHaveLength(1);
    // Exactly one finalize (the deduped delivery returns before finalizing).
    expect(writes.filter((w) => w.table === "square_sync_log" && w.op === "update")).toHaveLength(1);
  });

  it("debit RPC error marks the line FAILED, not synced", async () => {
    rpcResponse = { data: null, error: { message: "debit_bin_inventory boom" } };
    useTables({
      square_sync_log: CLAIM_OK,
      bins: BIN_SQ_LOC_1,
      square_catalog_map: MAP_PACKAGED,
      bin_inventory: { data: [lot("fg-1", 10, "2024-01-01")], error: null },
      allocations: { data: null, error: null },
    });

    const res = await post(EVENT);
    // The line failed, but the sale as a whole still ACKs 200 (Square must not
    // retry a per-line data problem).
    expect(res.status).toBe(200);

    const finalize = writes.find((w) => w.table === "square_sync_log" && w.op === "update")!.row as {
      items_synced: number;
      items_failed: number;
      details: { errors?: Array<{ error: string }> };
    };
    expect(finalize.items_synced).toBe(0);
    expect(finalize.items_failed).toBe(1);
    expect(finalize.details.errors?.[0].error).toContain("boom");
  });

  it("dedup-claim DB error returns 500 (not a silent 200 skip)", async () => {
    // A transient claim error must be distinguishable from a genuine duplicate.
    useTables({
      square_sync_log: { data: null, error: { message: "claim upsert failed" } },
      bins: BIN_SQ_LOC_1,
      square_catalog_map: MAP_PACKAGED,
      bin_inventory: { data: [lot("fg-1", 10, "2024-01-01")], error: null },
      allocations: { data: null, error: null },
    });

    const res = await post(EVENT);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "processing_failed" });

    // Threw before any side effect: no allocation, no debit.
    expect(rpcCalls).toHaveLength(0);
    expect(writes.some((w) => w.table === "allocations")).toBe(false);
  });

  it("unmapped Square location: bins lookup null → packaged line flagged, no debit, no allocation", async () => {
    useTables({
      square_sync_log: CLAIM_OK,
      bins: { data: null, error: null },
      square_catalog_map: MAP_PACKAGED,
      bin_inventory: { data: [lot("fg-1", 10, "2024-01-01")], error: null },
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
