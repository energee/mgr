/**
 * Square draft-sale reconciliation route tests (audit BD-2).
 *
 * Locked-in behaviors:
 *   - Unreconciled square_draft_sales rows become COMPLETED finished_good ->
 *     taproom_sale allocations: quantity in fractional KEGS (drawn bbl /
 *     per-keg bbl, matching guard_allocation_availability's keg-unit
 *     arithmetic), volume_bbl = volume_oz / 3968 (OZ_PER_BARREL),
 *     completed_at = the SALE time (TTB period attribution), and
 *     idempotency_key 'square_draft_sale:<id>'.
 *   - FIFO across the brand's keg-format lots by production_date; a sale
 *     spanning lots inserts ALL its rows in ONE statement (atomic under the
 *     availability guard).
 *   - Idempotent re-run: a sale whose key already exists in allocations never
 *     re-inserts — it only repairs a missing reconciled_at stamp.
 *   - A guard_allocation_availability rejection (insert error) is surfaced as
 *     a per-row failure and the batch CONTINUES; the failed sale is not
 *     stamped reconciled.
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

type AdminOpts = {
  /** square_draft_sales rows returned by the unreconciled read. */
  sales: unknown[];
  /** finished_goods keg-lot rows. */
  lots?: unknown[];
  /** idempotency keys already present in allocations. */
  existingKeys?: string[];
  /** Existing active allocations (availability read). */
  activeAllocations?: Array<{ source_id: string; quantity: number }>;
  /** Successive results for allocation INSERTs, consumed in order. */
  insertQueue?: QueryResult[];
};

function useAdmin(opts: AdminOpts) {
  const insertQueue = opts.insertQueue ? [...opts.insertQueue] : undefined;
  const tables: TableData = {
    square_draft_sales: ({ ops }: ResponseContext) =>
      ops.includes("update") ? { data: null, error: null } : { data: opts.sales, error: null },
    finished_goods: { data: opts.lots ?? [], error: null },
    allocations: ({ ops, calls }: ResponseContext) => {
      if (ops.includes("insert")) {
        if (insertQueue && insertQueue.length > 0) return insertQueue.shift()!;
        return { data: null, error: null };
      }
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
  const mock = makeAdminMock(tables, { onUnknownTable: "throw" });
  writes = mock.writes;
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

/** Allocation-insert writes (each row is the ARRAY for one draft sale). */
const allocationInserts = () =>
  writes.filter((w) => w.table === "allocations" && w.op === "insert");

const draftUpdates = () =>
  writes.filter((w) => w.table === "square_draft_sales" && w.op === "update");

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// Tests
// =============================================================================

describe("POST /api/square/reconcile-draft-sales", () => {
  it("happy path: converts each unreconciled sale into a completed taproom_sale allocation (keg quantity, bbl volume, sale-time completed_at) and stamps reconciled_at", async () => {
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

    // One atomic insert per sale, each drawing the single lot.
    const inserts = allocationInserts();
    expect(inserts).toHaveLength(2);
    const rows1 = inserts[0].row as Array<Record<string, unknown>>;
    expect(rows1).toHaveLength(1);
    expect(rows1[0]).toMatchObject({
      source_type: "finished_good",
      source_id: "fg-keg-1",
      destination_type: "taproom_sale",
      destination_id: null,
      reason_code: "other",
      status: "completed",
      // TTB period attribution: the SALE time, not the reconcile time.
      completed_at: "2026-07-01T00:00:00Z",
      idempotency_key: "square_draft_sale:ds-1",
    });
    // 48 oz = 48/3968 bbl; quantity in KEGS = bbl / 0.5 bbl-per-keg.
    expect(rows1[0].volume_bbl as number).toBeCloseTo(48 / OZ_PER_BARREL, 10);
    expect(rows1[0].quantity as number).toBeCloseTo(48 / OZ_PER_BARREL / 0.5, 10);

    const rows2 = inserts[1].row as Array<Record<string, unknown>>;
    expect(rows2[0]).toMatchObject({ idempotency_key: "square_draft_sale:ds-2" });
    expect(rows2[0].volume_bbl as number).toBeCloseTo(32 / OZ_PER_BARREL, 10);

    // Both sales stamped reconciled.
    const stamps = draftUpdates();
    expect(stamps).toHaveLength(2);
    expect(stamps[0].row).toMatchObject({ reconciled_at: expect.any(String) });

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

  it("FIFO across lots: a sale spanning two lots draws oldest first and inserts BOTH rows in ONE statement", async () => {
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

    // ONE insert statement carrying both lot draws — a guard rejection on
    // either row would land neither (atomicity of the per-sale insert).
    const inserts = allocationInserts();
    expect(inserts).toHaveLength(1);
    const rows = inserts[0].row as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.source_id)).toEqual(["fg-old", "fg-new"]);
    // Each lot covers 0.5 bbl = exactly 1 keg.
    expect(rows[0]).toMatchObject({ quantity: 1, volume_bbl: 0.5 });
    expect(rows[1]).toMatchObject({ quantity: 1, volume_bbl: 0.5 });
  });

  it("idempotent re-run: a sale whose idempotency key already exists never re-allocates — only the reconciled_at stamp is repaired", async () => {
    // ds-1 crashed after its allocation insert but before the stamp: the key
    // exists, the row is still unreconciled. A re-run must not double-count
    // the TTB removal.
    useAdmin({
      sales: [draftSale("ds-1", 48, "2026-07-01T00:00:00Z")],
      lots: [kegLot("fg-keg-1", 2, "2024-01-01")],
      existingKeys: ["square_draft_sale:ds-1"],
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

    // No new allocations; the stamp repair is the only draft-sales write.
    expect(allocationInserts()).toHaveLength(0);
    expect(draftUpdates()).toHaveLength(1);
  });

  it("guard rejection: an availability-guard insert error is surfaced per row, the sale stays unreconciled, and the batch continues", async () => {
    useAdmin({
      sales: [
        draftSale("ds-1", 48, "2026-07-01T00:00:00Z"),
        draftSale("ds-2", 32, "2026-07-02T00:00:00Z"),
      ],
      lots: [kegLot("fg-keg-1", 2, "2024-01-01")],
      insertQueue: [
        // guard_allocation_availability (00212) rejecting the first sale.
        { data: null, error: { message: "Allocation of 0.024 exceeds availability (2 on hand, 2 already allocated) for this finished_good." } },
        { data: null, error: null },
      ],
    });

    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ processed: 2, reconciled: 1, failed: 1 });
    expect(body.data.failures).toEqual([
      { draftSaleId: "ds-1", error: expect.stringContaining("exceeds availability") },
    ]);

    // Both inserts attempted (the batch continued past the rejection)...
    expect(allocationInserts()).toHaveLength(2);
    // ...but only the successful sale was stamped reconciled.
    expect(draftUpdates()).toHaveLength(1);

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

  it("insufficient availability: a brand with no keg lots fails the row WITHOUT inserting anything, and the pool math honors existing allocations", async () => {
    // The lot nominally holds 2 kegs but 1.96 are already allocated: available
    // capacity is 0.04 kegs = 0.02 bbl, and the sale needs 1 bbl. The plan
    // falls short, so NOTHING is inserted (no partial draw) and the row fails.
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

    expect(allocationInserts()).toHaveLength(0);
    expect(draftUpdates()).toHaveLength(0);
  });

  it("no unreconciled sales: returns zeros without touching allocations", async () => {
    useAdmin({ sales: [] });

    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ processed: 0, reconciled: 0, failed: 0 });
    expect(allocationInserts()).toHaveLength(0);
  });
});
