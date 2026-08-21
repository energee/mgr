/**
 * Square draft-sale reconciliation route tests (audit BD-2; atomicity #834).
 *
 * Locked-in behaviors:
 *   - Unreconciled square_draft_sales rows become COMPLETED finished_good ->
 *     taproom_sale allocations via ONE reconcile_square_draft_sale_atomic
 *     (00293) call per sale: the RPC receives the FIFO-planned rows
 *     (quantity in fractional KEGS = drawn bbl / per-keg bbl, volume_bbl =
 *     volume_oz / 3968, completed_at = the SALE time) plus the sale id it
 *     derives the idempotency key from, and performs key-check + insert +
 *     reconciled_at stamp in one transaction.
 *   - FIFO across the brand's keg-format lots by production_date; a sale
 *     spanning lots passes ALL its rows in the single RPC call.
 *   - Idempotent re-run: a sale whose key already exists still goes through
 *     the RPC (empty rows) so a missing reconciled_at stamp is repaired
 *     in-transaction, but is counted alreadyReconciled, never re-planned.
 *   - A concurrent-run loss ('already_keyed' despite a clean key read) and a
 *     mid-run void ('voided') are absorbed without failure entries.
 *   - A guard_allocation_availability rejection (RPC error) is surfaced as a
 *     per-row failure and the batch CONTINUES.
 *   - Every run writes a draft_reconcile square_sync_log summary row.
 *
 * The Supabase admin client is faked with the shared admin mock
 * (src/test/supabase-admin-mock.ts); withPermission is stubbed to a
 * pass-through so the handler logic is exercised directly.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { OZ_PER_BARREL } from "@/domain/consumption-planning";
import {
  makeAdminMock,
  type QueryResult,
  type ResponseContext,
  type TableData,
  type Write,
} from "@/test/supabase-admin-mock";

// -----------------------------------------------------------------------------
// Mocks (must precede route imports)
// -----------------------------------------------------------------------------

vi.mock("@/lib/api/auth", () => ({
  withPermission:
    (_perm: string, handler: (req: unknown, ctx: unknown) => unknown) =>
    (req: unknown) =>
      handler(req, { user: { id: "user-1" } }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/integrations/square/client", () => ({
  getSquareClient: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/server";
import { POST } from "@/app/api/square/reconcile-draft-sales/route";

const mockedCreateAdminClient = vi.mocked(createAdminClient);

// -----------------------------------------------------------------------------
// In-memory admin (shared mock)
// -----------------------------------------------------------------------------

/** Every write the handler performs, in order. Re-created by useAdmin. */
let writes: Write[];
/** Every .rpc() the handler performs, in order. Re-created by useAdmin. */
let rpcCalls: Array<{ fn: string; args: unknown }>;

type AdminOpts = {
  /** square_draft_sales rows returned by the unreconciled read. */
  sales: unknown[];
  /** finished_goods keg-lot rows. */
  lots?: unknown[];
  /** idempotency keys already present in allocations. */
  existingKeys?: string[];
  /** Existing active allocations (availability read). */
  activeAllocations?: Array<{ source_id: string; quantity: number }>;
  /** Successive RPC results, consumed in order; default { data: "inserted" }. */
  rpcQueue?: QueryResult[];
};

function useAdmin(opts: AdminOpts) {
  const rpcQueue = opts.rpcQueue ? [...opts.rpcQueue] : undefined;
  const tables: TableData = {
    square_draft_sales: { data: opts.sales, error: null },
    finished_goods: { data: opts.lots ?? [], error: null },
    allocations: ({ calls }: ResponseContext) => {
      // The idempotency-key read filters .in("idempotency_key", …); the
      // availability read filters .eq("source_type", "finished_good").
      if (calls.some((c) => c.method === "in" && c.args[0] === "idempotency_key")) {
        return {
          data: (opts.existingKeys ?? []).map((k) => ({ idempotency_key: k })),
          error: null,
        };
      }
      return { data: opts.activeAllocations ?? [], error: null };
    },
    square_sync_log: { data: null, error: null },
  };
  const mock = makeAdminMock(tables, {
    onUnknownTable: "throw",
    rpc: () => {
      if (rpcQueue && rpcQueue.length > 0) return rpcQueue.shift()!;
      return { data: "inserted", error: null };
    },
  });
  writes = mock.writes;
  rpcCalls = mock.rpcCalls;
  mockedCreateAdminClient.mockResolvedValue(mock.admin as never);
}

/** A keg-format finished-good lot: 1/2 BBL container (1984 oz, 0.5 bbl). */
function kegLot(id: string, quantity: number, date: string | null) {
  return {
    id,
    brand_id: "brand-1",
    quantity,
    production_date: date,
    selling_formats: {
      unit_count: 1,
      containers: { type: "keg", volume_oz: 1984, volume_bbl: 0.5 },
    },
  };
}

function draftSale(id: string, volumeOz: number | null, soldAt: string, orderId = `order-${id}`) {
  return {
    id,
    brand_id: "brand-1",
    selling_format_id: "fmt-keg",
    quantity: 3,
    volume_oz: volumeOz,
    sold_at: soldAt,
    square_order_id: orderId,
  };
}

const post = () =>
  POST(new NextRequest("http://localhost/api/square/reconcile-draft-sales", { method: "POST" }));

type ReconcileArgs = {
  p_sale_id: string;
  p_rows: Array<Record<string, unknown>>;
  p_reconciled_at: string;
};

/** Calls to the atomic reconcile RPC, in order. */
const reconcileCalls = () =>
  rpcCalls
    .filter((c) => c.fn === "reconcile_square_draft_sale_atomic")
    .map((c) => c.args as ReconcileArgs);

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// Tests
// =============================================================================

describe("POST /api/square/reconcile-draft-sales", () => {
  it("happy path: one atomic RPC per sale carrying the planned taproom_sale rows (keg quantity, bbl volume, sale-time completed_at)", async () => {
    useAdmin({
      sales: [
        draftSale("ds-1", 48, "2026-07-01T00:00:00Z"),
        draftSale("ds-2", 32, "2026-07-02T00:00:00Z"),
      ],
      lots: [kegLot("fg-keg-1", 2, "2024-01-01")],
    });

    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({
      processed: 2,
      reconciled: 2,
      alreadyReconciled: 0,
      failed: 0,
      failures: [],
    });
    expect(body.data.totalVolumeBbl).toBeCloseTo(80 / OZ_PER_BARREL, 10);

    const calls = reconcileCalls();
    expect(calls).toHaveLength(2);
    expect(calls[0].p_sale_id).toBe("ds-1");
    expect(calls[0].p_reconciled_at).toEqual(expect.any(String));
    expect(calls[0].p_rows).toHaveLength(1);
    expect(calls[0].p_rows[0]).toMatchObject({
      source_id: "fg-keg-1",
      // TTB period attribution: the SALE time, not the reconcile time.
      completed_at: "2026-07-01T00:00:00Z",
      notes: "Square draft sale reconciliation (order order-ds-1)",
    });
    // 48 oz = 48/3968 bbl; quantity in KEGS = bbl / 0.5 bbl-per-keg.
    expect(calls[0].p_rows[0].volume_bbl as number).toBeCloseTo(48 / OZ_PER_BARREL, 10);
    expect(calls[0].p_rows[0].quantity as number).toBeCloseTo(48 / OZ_PER_BARREL / 0.5, 10);
    expect(calls[1].p_sale_id).toBe("ds-2");
    expect(calls[1].p_rows[0].volume_bbl as number).toBeCloseTo(32 / OZ_PER_BARREL, 10);

    // No direct writes to allocations or square_draft_sales — the RPC owns them.
    expect(writes.filter((w) => w.table === "allocations")).toHaveLength(0);
    expect(writes.filter((w) => w.table === "square_draft_sales")).toHaveLength(0);

    // Durable run summary.
    const log = writes.find((w) => w.table === "square_sync_log" && w.op === "insert")!.row as {
      sync_type: string;
      items_synced: number;
      items_failed: number;
    };
    expect(log.sync_type).toBe("draft_reconcile");
    expect(log.items_synced).toBe(2);
    expect(log.items_failed).toBe(0);
  });

  it("FIFO across lots: a sale spanning two lots draws oldest first and passes BOTH rows in ONE RPC call", async () => {
    // 3968 oz = 1.0 bbl; two half-bbl lots (1 keg each), returned out of order
    // to prove the handler sorts by production_date.
    useAdmin({
      sales: [draftSale("ds-1", 3968, "2026-07-01T00:00:00Z")],
      lots: [kegLot("fg-new", 1, "2024-06-01"), kegLot("fg-old", 1, "2024-01-01")],
    });

    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ reconciled: 1, failed: 0 });

    const calls = reconcileCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].p_rows.map((r) => r.source_id)).toEqual(["fg-old", "fg-new"]);
    // Each lot covers 0.5 bbl = exactly 1 keg.
    expect(calls[0].p_rows[0]).toMatchObject({ quantity: 1, volume_bbl: 0.5 });
    expect(calls[0].p_rows[1]).toMatchObject({ quantity: 1, volume_bbl: 0.5 });
  });

  it("idempotent re-run: a sale whose idempotency key already exists is never re-planned — the RPC is called with empty rows to repair the stamp", async () => {
    // ds-1 crashed after its allocation insert but before the stamp (pre-00293
    // history): the key exists, the row is still unreconciled. A re-run must
    // not double-count the TTB removal.
    useAdmin({
      sales: [draftSale("ds-1", 48, "2026-07-01T00:00:00Z")],
      lots: [kegLot("fg-keg-1", 2, "2024-01-01")],
      existingKeys: ["square_draft_sale:ds-1"],
      rpcQueue: [{ data: "already_keyed", error: null }],
    });

    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({
      processed: 1,
      reconciled: 0,
      alreadyReconciled: 1,
      failed: 0,
    });

    const calls = reconcileCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].p_rows).toEqual([]);
  });

  it("concurrent-run loss: 'already_keyed' from the RPC despite a clean key read counts alreadyReconciled, no failure", async () => {
    useAdmin({
      sales: [draftSale("ds-1", 48, "2026-07-01T00:00:00Z")],
      lots: [kegLot("fg-keg-1", 2, "2024-01-01")],
      rpcQueue: [{ data: "already_keyed", error: null }],
    });

    const res = await post();
    const body = await res.json();
    expect(body.data).toMatchObject({
      processed: 1,
      reconciled: 0,
      alreadyReconciled: 1,
      failed: 0,
    });
    // The planned rows were sent; the RPC discarded them in-transaction.
    expect(reconcileCalls()[0].p_rows).toHaveLength(1);
  });

  it("mid-run void: 'voided' from the RPC is skipped without a failure entry", async () => {
    useAdmin({
      sales: [draftSale("ds-1", 48, "2026-07-01T00:00:00Z")],
      lots: [kegLot("fg-keg-1", 2, "2024-01-01")],
      rpcQueue: [{ data: "voided", error: null }],
    });

    const res = await post();
    const body = await res.json();
    expect(body.data).toMatchObject({
      processed: 1,
      reconciled: 0,
      alreadyReconciled: 0,
      failed: 0,
    });
  });

  it("guard rejection: an availability-guard RPC error is surfaced per row, the sale stays unreconciled, and the batch continues", async () => {
    useAdmin({
      sales: [
        draftSale("ds-1", 48, "2026-07-01T00:00:00Z"),
        draftSale("ds-2", 32, "2026-07-02T00:00:00Z"),
      ],
      lots: [kegLot("fg-keg-1", 2, "2024-01-01")],
      rpcQueue: [
        // guard_allocation_availability (00212) rejecting the first sale
        // rolls back its whole transaction inside the RPC.
        { data: null, error: { message: "Allocation of 0.024 exceeds availability (2 on hand, 2 already allocated) for this finished_good." } },
        { data: "inserted", error: null },
      ],
    });

    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ processed: 2, reconciled: 1, failed: 1 });
    expect(body.data.failures).toEqual([
      { draftSaleId: "ds-1", error: expect.stringContaining("exceeds availability") },
    ]);

    // Both RPCs attempted (the batch continued past the rejection).
    expect(reconcileCalls()).toHaveLength(2);

    // The failure is durable in the run summary.
    const log = writes.find((w) => w.table === "square_sync_log" && w.op === "insert")!.row as {
      items_synced: number;
      items_failed: number;
      details: { failures?: Array<{ draftSaleId: string }> };
    };
    expect(log.items_synced).toBe(1);
    expect(log.items_failed).toBe(1);
    expect(log.details.failures).toEqual([
      expect.objectContaining({ draftSaleId: "ds-1" }),
    ]);
  });

  it("insufficient availability: a shortfall fails the row WITHOUT calling the RPC, and the pool math honors existing allocations", async () => {
    // The lot nominally holds 2 kegs but 1.96 are already allocated: available
    // capacity is 0.04 kegs = 0.02 bbl, and the sale needs 1 bbl. The plan
    // falls short, so NOTHING is sent (no partial draw) and the row fails.
    useAdmin({
      sales: [draftSale("ds-1", 3968, "2026-07-01T00:00:00Z")],
      lots: [kegLot("fg-keg-1", 2, "2024-01-01")],
      activeAllocations: [{ source_id: "fg-keg-1", quantity: 1.96 }],
    });

    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ processed: 1, reconciled: 0, failed: 1 });
    expect(body.data.failures[0].error).toContain("Insufficient keg-format finished-good availability");

    expect(reconcileCalls()).toHaveLength(0);
  });

  it("no unreconciled sales: returns zeros without touching allocations", async () => {
    useAdmin({ sales: [] });

    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ processed: 0, reconciled: 0, failed: 0 });
    expect(reconcileCalls()).toHaveLength(0);
  });
});
