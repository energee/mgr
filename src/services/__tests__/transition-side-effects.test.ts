// @vitest-environment node
/**
 * Transition Side Effects — registry entry tests
 *
 * Covers the registry's non-batch entries directly against mock Supabase
 * clients:
 * - pick_lists → in_progress/completed: parent order status sync (audit S3).
 *   Both UPDATEs must be status-guarded so mismatched/raced order states are
 *   harmless 0-row no-ops that never trip the server-side transition
 *   validator (migration 00143).
 * - batches → completed: consumption + loss reconciliation + vessel release
 *   (consumption-service calls mocked).
 * - orders → fulfilled/cancelled: complete/release FG→order reservations
 *   (audit H1/M12), volume stamped from the finished good's container.
 * - orders → fulfilled with NO reservations: synthesize completed removal
 *   allocations from order_items (audit BD-5) — FIFO draw, per-item
 *   idempotency keys, keg-line exclusion, shortfall/guard-rejection
 *   surfacing.
 * - deliveries → completed: flip linked packed orders to fulfilled and chain
 *   the orders → fulfilled entry (audit EA-2).
 */

import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueryClient } from "@tanstack/react-query";
import type { Database } from "@/types/supabase";
import { makeSupabase, type QueuedResponse } from "@/test/supabase-mock";

// The batches/packaging entries call into consumption-service; mock it so
// importing the module under test never touches a real client.
vi.mock("../consumption-service", () => ({
  completeBatchConsumption: vi.fn(),
  reconcileBatchLoss: vi.fn(),
  consumePackagingMaterials: vi.fn(),
}));

// The module logs guard rejections / shortfalls; keep tests silent and free
// of the Sentry transport client-logger pulls in.
vi.mock("@/lib/client-logger", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { runTransitionSideEffects } from "../transition-side-effects";

// =============================================================================
// Mock Supabase Builder
// =============================================================================

type ListResult = { data: { order_id: string }[] | null; error: { message: string } | null };

/**
 * Builds a mock client covering the two queries the pick_lists entries run:
 *   from("pick_lists").select("order_id").in("id", ids)        → listResult
 *   from("orders").update({status}).in("id", ...).eq("status") → updateResult
 */
function createMockSupabase(
  listResult: ListResult,
  updateResult: { error: { message: string } | null } = { error: null }
) {
  const selectIn = vi.fn().mockResolvedValue(listResult);
  const select = vi.fn(() => ({ in: selectIn }));
  const updateEq = vi.fn().mockResolvedValue(updateResult);
  const updateIn = vi.fn(() => ({ eq: updateEq }));
  const update = vi.fn(() => ({ in: updateIn }));
  const from = vi.fn((table: string) =>
    table === "pick_lists" ? { select } : { update }
  );
  return {
    client: { from } as unknown as SupabaseClient<Database>,
    from,
    selectIn,
    update,
    updateIn,
    updateEq,
  };
}

function createMockQueryClient() {
  const invalidateQueries = vi.fn();
  return {
    queryClient: { invalidateQueries } as unknown as QueryClient,
    invalidateQueries,
  };
}

const PICK_LIST_ID = "00000000-0000-0000-0000-000000000001";
const ORDER_A = "00000000-0000-0000-0000-00000000000a";
const ORDER_B = "00000000-0000-0000-0000-00000000000b";

// =============================================================================
// pick_lists → in_progress
// =============================================================================

describe("runTransitionSideEffects: pick_lists → in_progress", () => {
  it("moves the parent order scheduled → picking, guarded on the prior status", async () => {
    const mock = createMockSupabase({ data: [{ order_id: ORDER_A }], error: null });

    const result = await runTransitionSideEffects(
      mock.client,
      "pick_lists",
      [PICK_LIST_ID],
      "in_progress"
    );

    expect(result.error).toBeNull();
    expect(mock.from).toHaveBeenCalledWith("pick_lists");
    expect(mock.selectIn).toHaveBeenCalledWith("id", [PICK_LIST_ID]);
    expect(mock.from).toHaveBeenCalledWith("orders");
    expect(mock.update).toHaveBeenCalledWith({ status: "picking" });
    expect(mock.updateIn).toHaveBeenCalledWith("id", [ORDER_A]);
    // The .eq guard makes a mismatched order state (e.g. still "confirmed")
    // a 0-row no-op instead of a check_violation from migration 00143.
    expect(mock.updateEq).toHaveBeenCalledWith("status", "scheduled");
  });

  it("dedupes order ids when several pick lists share an order", async () => {
    const mock = createMockSupabase({
      data: [{ order_id: ORDER_A }, { order_id: ORDER_A }, { order_id: ORDER_B }],
      error: null,
    });

    await runTransitionSideEffects(mock.client, "pick_lists", ["id1", "id2", "id3"], "in_progress");

    expect(mock.updateIn).toHaveBeenCalledWith("id", [ORDER_A, ORDER_B]);
  });

  it("skips the orders update when no pick lists are found", async () => {
    const mock = createMockSupabase({ data: [], error: null });

    const result = await runTransitionSideEffects(
      mock.client,
      "pick_lists",
      [PICK_LIST_ID],
      "in_progress"
    );

    expect(result.error).toBeNull();
    expect(mock.from).not.toHaveBeenCalledWith("orders");
  });
});

// =============================================================================
// pick_lists → completed
// =============================================================================

describe("runTransitionSideEffects: pick_lists → completed", () => {
  it("moves the parent order picking → packed, guarded on the prior status", async () => {
    const mock = createMockSupabase({ data: [{ order_id: ORDER_A }], error: null });

    const result = await runTransitionSideEffects(
      mock.client,
      "pick_lists",
      [PICK_LIST_ID],
      "completed"
    );

    expect(result.error).toBeNull();
    expect(mock.update).toHaveBeenCalledWith({ status: "packed" });
    expect(mock.updateEq).toHaveBeenCalledWith("status", "picking");
  });

  it("invalidates order caches via the optional queryClient on success", async () => {
    const mock = createMockSupabase({ data: [{ order_id: ORDER_A }], error: null });
    const { queryClient, invalidateQueries } = createMockQueryClient();

    await runTransitionSideEffects(
      mock.client,
      "pick_lists",
      [PICK_LIST_ID],
      "completed",
      queryClient
    );

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["orders"] });
  });

  it("surfaces a fetch failure without attempting the orders update", async () => {
    const mock = createMockSupabase({ data: null, error: { message: "boom" } });

    const result = await runTransitionSideEffects(
      mock.client,
      "pick_lists",
      [PICK_LIST_ID],
      "completed"
    );

    expect(result.error).toContain("syncing the order status failed");
    expect(result.error).toContain("boom");
    expect(mock.from).not.toHaveBeenCalledWith("orders");
  });

  it("surfaces an orders update failure and skips cache invalidation", async () => {
    const mock = createMockSupabase(
      { data: [{ order_id: ORDER_A }], error: null },
      { error: { message: "rls denied" } }
    );
    const { queryClient, invalidateQueries } = createMockQueryClient();

    const result = await runTransitionSideEffects(
      mock.client,
      "pick_lists",
      [PICK_LIST_ID],
      "completed",
      queryClient
    );

    expect(result.error).toContain("rls denied");
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Non-matching transitions
// =============================================================================

describe("runTransitionSideEffects: registry matching", () => {
  it("does nothing for pick_lists transitions without registered effects", async () => {
    const mock = createMockSupabase({ data: [{ order_id: ORDER_A }], error: null });

    for (const toState of ["draft", "assigned", "cancelled"]) {
      const result = await runTransitionSideEffects(
        mock.client,
        "pick_lists",
        [PICK_LIST_ID],
        toState
      );
      expect(result.error).toBeNull();
    }
    expect(mock.from).not.toHaveBeenCalled();
  });

  it("does nothing for unrelated tables", async () => {
    const mock = createMockSupabase({ data: [], error: null });

    const result = await runTransitionSideEffects(
      mock.client,
      "customers",
      [ORDER_A],
      "active"
    );

    expect(result.error).toBeNull();
    expect(mock.from).not.toHaveBeenCalled();
  });

  it("does nothing for orders transitions without registered effects", async () => {
    const mock = createMockSupabase({ data: [], error: null });

    // Only fulfilled/cancelled have orders entries — intermediate states don't.
    for (const toState of ["confirmed", "scheduled", "picking", "packed"]) {
      const result = await runTransitionSideEffects(mock.client, "orders", [ORDER_A], toState);
      expect(result.error).toBeNull();
    }
    expect(mock.from).not.toHaveBeenCalled();
  });
});

// =============================================================================
// batches → completed (consumption + loss reconciliation)
// =============================================================================

import {
  completeBatchConsumption,
  reconcileBatchLoss,
  consumePackagingMaterials,
} from "../consumption-service";

const BATCH_A = "00000000-0000-0000-0000-0000000000ba";
const BATCH_B = "00000000-0000-0000-0000-0000000000bb";

describe("runTransitionSideEffects: batches → completed", () => {
  it("confirms consumption and reconciles packaged-vs-produced loss per batch", async () => {
    const mock = createMockSupabase({ data: [], error: null });
    vi.mocked(completeBatchConsumption).mockResolvedValue({
      success: true,
      data: 2,
      invalidate: [],
    });
    vi.mocked(reconcileBatchLoss).mockResolvedValue({
      success: true,
      data: 1.5,
      invalidate: [],
    });

    const result = await runTransitionSideEffects(
      mock.client,
      "batches",
      [BATCH_A, BATCH_B],
      "completed"
    );

    expect(result.error).toBeNull();
    expect(result.completedAllocations).toBe(4);
    expect(result.reconciledLossBbl).toBeCloseTo(3);
    expect(completeBatchConsumption).toHaveBeenCalledTimes(2);
    expect(reconcileBatchLoss).toHaveBeenCalledWith(mock.client, BATCH_A);
    expect(reconcileBatchLoss).toHaveBeenCalledWith(mock.client, BATCH_B);
  });

  it("releases the completed batches' vessels (empty + dirty, matching cancel/archive RPCs)", async () => {
    const mock = createMockSupabase({ data: [], error: null });
    vi.mocked(completeBatchConsumption).mockResolvedValue({
      success: true,
      data: 0,
      invalidate: [],
    });
    vi.mocked(reconcileBatchLoss).mockResolvedValue({ success: true, data: 0, invalidate: [] });

    await runTransitionSideEffects(mock.client, "batches", [BATCH_A, BATCH_B], "completed");

    expect(mock.from).toHaveBeenCalledWith("vessels");
    expect(mock.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "dirty", current_batch_id: null })
    );
    expect(mock.updateIn).toHaveBeenCalledWith("current_batch_id", [BATCH_A, BATCH_B]);
  });

  it("surfaces reconciliation failures without dropping the allocations count", async () => {
    const mock = createMockSupabase({ data: [], error: null });
    vi.mocked(completeBatchConsumption).mockResolvedValue({
      success: true,
      data: 1,
      invalidate: [],
    });
    vi.mocked(reconcileBatchLoss).mockResolvedValue({
      success: false,
      error: { code: "UNKNOWN", message: "insert denied" },
    });

    const result = await runTransitionSideEffects(mock.client, "batches", [BATCH_A], "completed");

    expect(result.error).toContain("loss reconciliation");
    expect(result.error).toContain("insert denied");
    expect(result.completedAllocations).toBe(1);
    expect(result.reconciledLossBbl).toBe(0);
  });
});

// =============================================================================
// orders → fulfilled / cancelled (FG→order reservation completion/release)
// =============================================================================

// These entries chain more query shapes than the local mock above supports,
// so they use the shared table-keyed fake from @/test/supabase-mock.

describe("runTransitionSideEffects: orders → fulfilled", () => {
  it("completes planned FG reservations with volume from the finished good's container, guarded on status", async () => {
    const { supabase, callsByTable } = makeSupabase({
      allocations: [
        {
          data: [
            { id: "a1", source_id: "fg-1", quantity: 10, destination_id: ORDER_A },
            { id: "a2", source_id: "fg-2", quantity: 5, destination_id: ORDER_A },
          ],
          error: null,
        },
        { data: null, error: null }, // update a1
        { data: null, error: null }, // update a2
      ],
      finished_goods: [
        {
          data: [
            {
              id: "fg-1",
              // 2 units × 0.5 bbl container → 1.0 bbl per selling unit
              selling_format: { unit_count: 2, container: { volume_bbl: 0.5, volume_oz: null } },
            },
            {
              id: "fg-2",
              // volume_oz fallback: 3968 oz = 1 bbl per unit
              selling_format: { unit_count: 1, container: { volume_bbl: null, volume_oz: 3968 } },
            },
          ],
          error: null,
        },
      ],
    });

    const result = await runTransitionSideEffects(supabase, "orders", [ORDER_A], "fulfilled");

    expect(result.error).toBeNull();
    // The order HAS reservations → the synthesis path must not run (the fake
    // throws on any unqueued table, so no order_items read = no synthesis).
    expect(callsByTable.order_items).toBeUndefined();
    // Read pinned to this order's still-planned FG reservations only.
    const read = callsByTable.allocations[0];
    expect(read.eq.mock.calls).toEqual(
      expect.arrayContaining([
        ["destination_type", "order"],
        ["source_type", "finished_good"],
        ["status", "planned"],
      ])
    );
    expect(read.in).toHaveBeenCalledWith("destination_id", [ORDER_A]);
    // Volume + status flip in the SAME update, guarded on status='planned'
    // (idempotent — a racing second path matches 0 rows).
    const updateA1 = callsByTable.allocations[1];
    expect(updateA1.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed", volume_bbl: 10, completed_at: expect.any(String) })
    );
    expect(updateA1.eq.mock.calls).toEqual([
      ["id", "a1"],
      ["status", "planned"],
    ]);
    const updateA2 = callsByTable.allocations[2];
    expect(updateA2.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed", volume_bbl: 5 })
    );
    expect(updateA2.eq.mock.calls).toEqual([
      ["id", "a2"],
      ["status", "planned"],
    ]);
  });

  it("completes with volume_bbl NULL and surfaces a non-fatal warning when container volume data is missing", async () => {
    const { supabase, callsByTable } = makeSupabase({
      allocations: [
        { data: [{ id: "a1", source_id: "fg-1", quantity: 10, destination_id: ORDER_A }], error: null },
        { data: null, error: null }, // update a1
      ],
      finished_goods: [
        {
          data: [
            {
              id: "fg-1",
              selling_format: { unit_count: 24, container: { volume_bbl: null, volume_oz: null } },
            },
          ],
          error: null,
        },
      ],
    });

    const result = await runTransitionSideEffects(supabase, "orders", [ORDER_A], "fulfilled");

    // The reservation is still completed — the shipment physically happened.
    expect(callsByTable.allocations[1].update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed", volume_bbl: null })
    );
    expect(result.error).toContain("Order fulfilled, but");
    expect(result.error).toContain("without volume");
  });

  it("enters the synthesis path (not the completion path) when the order has no planned reservations", async () => {
    // No finished_goods queue: the fake throws loudly if the COMPLETION
    // path's volume lookup runs. Synthesis runs instead, and no-ops here
    // because the order has no line items.
    const { supabase, callsByTable } = makeSupabase({
      allocations: [
        { data: [], error: null }, // planned-reservation read
        { data: [], error: null }, // synthesis: existing-allocation guard read
      ],
      order_items: [{ data: [], error: null }],
    });

    const result = await runTransitionSideEffects(supabase, "orders", [ORDER_A], "fulfilled");

    expect(result.error).toBeNull();
    expect(callsByTable.allocations).toHaveLength(2); // reads only, no writes
    expect(callsByTable.order_items).toHaveLength(1);
  });

  it("surfaces a reservation read failure", async () => {
    const { supabase } = makeSupabase({
      allocations: [{ data: null, error: { message: "boom" } }],
    });

    const result = await runTransitionSideEffects(supabase, "orders", [ORDER_A], "fulfilled");

    expect(result.error).toContain("completing its inventory reservations failed");
    expect(result.error).toContain("boom");
  });
});

describe("runTransitionSideEffects: orders → cancelled", () => {
  it("releases still-planned FG reservations in one status-guarded UPDATE, leaving completed rows untouched", async () => {
    const { supabase, callsByTable } = makeSupabase({
      allocations: [{ data: null, error: null }],
    });

    const result = await runTransitionSideEffects(supabase, "orders", [ORDER_A], "cancelled");

    expect(result.error).toBeNull();
    const release = callsByTable.allocations[0];
    expect(release.update).toHaveBeenCalledWith({ status: "cancelled" });
    // status='planned' guard: completed removals stay removed; re-running is
    // a 0-row no-op.
    expect(release.eq.mock.calls).toEqual(
      expect.arrayContaining([
        ["destination_type", "order"],
        ["source_type", "finished_good"],
        ["status", "planned"],
      ])
    );
    expect(release.in).toHaveBeenCalledWith("destination_id", [ORDER_A]);
  });

  it("invalidates allocation + finished-goods availability caches on success", async () => {
    const { supabase } = makeSupabase({ allocations: [{ data: null, error: null }] });
    const { queryClient, invalidateQueries } = createMockQueryClient();

    await runTransitionSideEffects(supabase, "orders", [ORDER_A], "cancelled", queryClient);

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["allocations"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["finished-goods-available"] });
  });

  it("surfaces a release failure", async () => {
    const { supabase } = makeSupabase({
      allocations: [{ data: null, error: { message: "rls denied" } }],
    });

    const result = await runTransitionSideEffects(supabase, "orders", [ORDER_A], "cancelled");

    expect(result.error).toContain("releasing its inventory reservations failed");
    expect(result.error).toContain("rls denied");
  });
});

// =============================================================================
// orders → fulfilled: removal synthesis (audit BD-5)
// =============================================================================

// Orders fulfilled WITHOUT reservations get completed FG→order allocations
// synthesized from order_items: (brand, selling_format) resolved to
// finished_goods lots FIFO (production_date NULLS LAST, then lot_number),
// volume via computeUnitFillVolumeBbl, idempotency_key
// `order_fulfill:<order_id>:<order_item_id>`. Keg-container lines are
// excluded (they flow through create_keg_ship_transactions_from_order — see
// the module's deferred keg-attribution note).

const ITEM_1 = "00000000-0000-0000-0000-00000000i001";
const ITEM_KEG = "00000000-0000-0000-0000-00000000i002";
const BRAND_1 = "00000000-0000-0000-0000-00000000br01";

/** Queues for the synthesis happy path: one case line (10) + one keg line. */
function synthesisQueues(): Record<string, QueuedResponse[]> {
  return {
    allocations: [
      { data: [], error: null }, // planned-reservation read → none
      { data: [], error: null }, // synthesis: existing-allocation guard read
      // per-lot active allocations: fg-old has 2 already committed → 4 remain
      { data: [{ source_id: "fg-old", quantity: 2 }], error: null },
      { data: null, error: null }, // insert draw 1 (fg-old)
      { data: null, error: null }, // insert draw 2 (fg-new)
    ],
    order_items: [
      {
        data: [
          {
            id: ITEM_1,
            order_id: ORDER_A,
            brand_id: BRAND_1,
            selling_format_id: "sf-case",
            quantity: 10,
          },
          {
            id: ITEM_KEG,
            order_id: ORDER_A,
            brand_id: BRAND_1,
            selling_format_id: "sf-keg",
            quantity: 3,
          },
        ],
        error: null,
      },
    ],
    selling_formats: [
      {
        data: [
          {
            id: "sf-case",
            // 2 units × 3968 oz (= 1 bbl) per unit → 2 bbl per selling unit
            unit_count: 2,
            container: { type: "can", volume_bbl: null, volume_oz: 3968 },
          },
          {
            id: "sf-keg",
            unit_count: 1,
            container: { type: "keg", volume_bbl: 0.5, volume_oz: null },
          },
        ],
        error: null,
      },
    ],
    finished_goods: [
      {
        data: [
          // Listed newest-first to prove the FIFO sort, not response order,
          // decides the draw.
          {
            id: "fg-new",
            brand_id: BRAND_1,
            selling_format_id: "sf-case",
            quantity: 100,
            production_date: "2026-06-01",
            lot_number: "L2",
          },
          {
            id: "fg-old",
            brand_id: BRAND_1,
            selling_format_id: "sf-case",
            quantity: 6,
            production_date: "2026-01-01",
            lot_number: "L1",
          },
        ],
        error: null,
      },
    ],
  };
}

describe("runTransitionSideEffects: orders → fulfilled (removal synthesis, BD-5)", () => {
  it("synthesizes completed allocations from order_items — FIFO across lots, volume from the container, per-item idempotency key", async () => {
    const { supabase, callsByTable } = makeSupabase(synthesisQueues());

    const result = await runTransitionSideEffects(supabase, "orders", [ORDER_A], "fulfilled");

    expect(result.error).toBeNull();

    // Guard read pinned to this order's active FG→order allocations.
    const guardRead = callsByTable.allocations[1];
    expect(guardRead.eq.mock.calls).toEqual(
      expect.arrayContaining([
        ["destination_type", "order"],
        ["source_type", "finished_good"],
      ])
    );
    expect(guardRead.in.mock.calls).toEqual(
      expect.arrayContaining([
        ["destination_id", [ORDER_A]],
        ["status", ["planned", "completed"]],
      ])
    );

    // FIFO: fg-old (production 2026-01-01, 6 on hand − 2 committed = 4
    // available) drains first, fg-new covers the remaining 6. Volume = draw ×
    // 2 bbl/unit; both rows share the line's idempotency key (00215: one key
    // per (order, item), many rows per key on a lot split).
    const insertOld = callsByTable.allocations[3];
    expect(insertOld.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        source_type: "finished_good",
        source_id: "fg-old",
        destination_type: "order",
        destination_id: ORDER_A,
        quantity: 4,
        volume_bbl: 8,
        status: "completed",
        completed_at: expect.any(String),
        lot_number: "L1",
        idempotency_key: `order_fulfill:${ORDER_A}:${ITEM_1}`,
      })
    );
    const insertNew = callsByTable.allocations[4];
    expect(insertNew.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        source_id: "fg-new",
        quantity: 6,
        volume_bbl: 12,
        idempotency_key: `order_fulfill:${ORDER_A}:${ITEM_1}`,
      })
    );

    // The keg line produced NO allocation (deferred to the keg_transactions
    // ledger): exactly the two case-line inserts above ran.
    expect(callsByTable.allocations).toHaveLength(5);
    const insertedKeys = [insertOld, insertNew].map(
      (b) => b.insert.mock.calls[0][0].idempotency_key
    );
    expect(insertedKeys).not.toContain(`order_fulfill:${ORDER_A}:${ITEM_KEG}`);
  });

  it("invalidates allocation caches after synthesizing", async () => {
    const { supabase } = makeSupabase(synthesisQueues());
    const { queryClient, invalidateQueries } = createMockQueryClient();

    await runTransitionSideEffects(supabase, "orders", [ORDER_A], "fulfilled", queryClient);

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["allocations"] });
  });

  it("is idempotent: a re-run skips items whose order_fulfill key already exists", async () => {
    const { supabase, callsByTable } = makeSupabase({
      allocations: [
        { data: [], error: null }, // planned read (first run completed rows, none planned)
        {
          // synthesis guard read: the first run's synthesized rows
          data: [
            {
              destination_id: ORDER_A,
              idempotency_key: `order_fulfill:${ORDER_A}:${ITEM_1}`,
            },
          ],
          error: null,
        },
      ],
      order_items: [
        {
          data: [
            {
              id: ITEM_1,
              order_id: ORDER_A,
              brand_id: BRAND_1,
              selling_format_id: "sf-case",
              quantity: 10,
            },
          ],
          error: null,
        },
      ],
    });

    const result = await runTransitionSideEffects(supabase, "orders", [ORDER_A], "fulfilled");

    expect(result.error).toBeNull();
    // Both allocation builders are reads; no inserts ran (and no
    // selling_formats/finished_goods queue was ever touched).
    expect(callsByTable.allocations).toHaveLength(2);
    expect(callsByTable.selling_formats).toBeUndefined();
  });

  it("skips synthesis entirely for an order whose allocations came from the reservation flow (no order_fulfill key)", async () => {
    const { supabase, callsByTable } = makeSupabase({
      allocations: [
        { data: [], error: null }, // planned read: a racing path already completed them
        {
          // guard read: completed reservation WITHOUT our key prefix
          data: [{ destination_id: ORDER_A, idempotency_key: null }],
          error: null,
        },
      ],
    });

    const result = await runTransitionSideEffects(supabase, "orders", [ORDER_A], "fulfilled");

    expect(result.error).toBeNull();
    expect(callsByTable.order_items).toBeUndefined(); // never even read
  });

  it("surfaces a guard/insert rejection without aborting the other rows (never silently swallowed)", async () => {
    const queues = synthesisQueues();
    // First insert (fg-old) rejected — e.g. guard_allocation_availability
    // (00212) tripping on a concurrent allocator.
    queues.allocations[3] = {
      data: null,
      error: { message: "Allocation of 4 exceeds availability (2 on hand, 0 already allocated) for this finished_good." },
    };

    const { supabase, callsByTable } = makeSupabase(queues);
    const result = await runTransitionSideEffects(supabase, "orders", [ORDER_A], "fulfilled");

    // The fulfillment stands; the rejection is surfaced in the result.
    expect(result.error).toContain("Order fulfilled, but");
    expect(result.error).toContain("removal allocation(s) failed");
    expect(result.error).toContain("exceeds availability");
    // The second row still went in (per-row inserts, partial-failure tolerant).
    expect(callsByTable.allocations[4].insert).toHaveBeenCalledWith(
      expect.objectContaining({ source_id: "fg-new", quantity: 6 })
    );
  });

  it("surfaces a stock shortfall as a warning and allocates only what is available", async () => {
    const queues = synthesisQueues();
    // Only fg-old (4 available after commitments) exists — the 10-unit line
    // cannot be covered.
    queues.finished_goods = [
      {
        data: [
          {
            id: "fg-old",
            brand_id: BRAND_1,
            selling_format_id: "sf-case",
            quantity: 6,
            production_date: "2026-01-01",
            lot_number: "L1",
          },
        ],
        error: null,
      },
    ];
    queues.allocations = [
      { data: [], error: null }, // planned read
      { data: [], error: null }, // guard read
      { data: [{ source_id: "fg-old", quantity: 2 }], error: null }, // per-lot active
      { data: null, error: null }, // single insert (the covered 4)
    ];

    const { supabase, callsByTable } = makeSupabase(queues);
    const result = await runTransitionSideEffects(supabase, "orders", [ORDER_A], "fulfilled");

    expect(callsByTable.allocations[3].insert).toHaveBeenCalledWith(
      expect.objectContaining({ source_id: "fg-old", quantity: 4 })
    );
    expect(callsByTable.allocations).toHaveLength(4); // no over-availability row
    expect(result.error).toContain("Order fulfilled, but");
    expect(result.error).toContain("exceed available finished-goods stock");
  });
});

// =============================================================================
// deliveries → completed (order fulfillment sync, audit EA-2)
// =============================================================================

const DELIVERY_A = "00000000-0000-0000-0000-0000000000d1";

describe("runTransitionSideEffects: deliveries → completed", () => {
  it("flips each linked packed order to fulfilled (status-guarded, per order) and chains the fulfillment effect for the flipped ids", async () => {
    const { supabase, callsByTable } = makeSupabase({
      orders: [
        { data: [{ id: ORDER_A }, { id: ORDER_B }], error: null }, // linked read
        { data: [{ id: ORDER_A }], error: null }, // flip A
        { data: [{ id: ORDER_B }], error: null }, // flip B
      ],
      // Chained orders → fulfilled entry for [A, B]:
      allocations: [
        { data: [], error: null }, // planned read
        { data: [], error: null }, // synthesis guard read
      ],
      order_items: [{ data: [], error: null }],
    });
    const { queryClient, invalidateQueries } = createMockQueryClient();

    const result = await runTransitionSideEffects(
      supabase,
      "deliveries",
      [DELIVERY_A],
      "completed",
      queryClient
    );

    expect(result.error).toBeNull();

    // Linked-order read pinned to this delivery's packed orders.
    const linkedRead = callsByTable.orders[0];
    expect(linkedRead.in).toHaveBeenCalledWith("delivery_id", [DELIVERY_A]);
    expect(linkedRead.eq).toHaveBeenCalledWith("status", "packed");

    // Each flip is its own status-guarded UPDATE (packed → fulfilled is the
    // 00143-legal edge; the guard makes raced/mismatched states 0-row no-ops,
    // and per-order statements keep one keg-shortfall trigger RAISE from
    // aborting the other orders on the run).
    const flipA = callsByTable.orders[1];
    expect(flipA.update).toHaveBeenCalledWith({ status: "fulfilled" });
    expect(flipA.eq.mock.calls).toEqual([
      ["id", ORDER_A],
      ["status", "packed"],
    ]);

    // The chained orders → fulfilled effect ran for BOTH flipped ids.
    const chainedRead = callsByTable.allocations[0];
    expect(chainedRead.in).toHaveBeenCalledWith("destination_id", [ORDER_A, ORDER_B]);

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["orders"] });
  });

  it("tolerates a partial failure: one order's flip error is surfaced while the others still chain", async () => {
    const { supabase, callsByTable } = makeSupabase({
      orders: [
        { data: [{ id: ORDER_A }, { id: ORDER_B }], error: null },
        // Flip A rejected — e.g. the keg-shortfall RAISE from
        // on_order_fulfillment_keg_transactions (00229).
        { data: null, error: { message: "cannot ship 5 keg(s)" } },
        { data: [{ id: ORDER_B }], error: null },
      ],
      allocations: [
        { data: [], error: null },
        { data: [], error: null },
      ],
      order_items: [{ data: [], error: null }],
    });

    const result = await runTransitionSideEffects(supabase, "deliveries", [DELIVERY_A], "completed");

    expect(result.error).toContain("Delivery completed, but");
    expect(result.error).toContain("cannot ship 5 keg(s)");
    // The chained effect ran for ORDER_B only.
    const chainedRead = callsByTable.allocations[0];
    expect(chainedRead.in).toHaveBeenCalledWith("destination_id", [ORDER_B]);
  });

  it("is idempotent: a re-run finds no packed orders and no-ops", async () => {
    const { supabase, callsByTable } = makeSupabase({
      orders: [{ data: [], error: null }],
    });

    const result = await runTransitionSideEffects(supabase, "deliveries", [DELIVERY_A], "completed");

    expect(result.error).toBeNull();
    expect(callsByTable.orders).toHaveLength(1); // read only, no updates
    expect(callsByTable.allocations).toBeUndefined(); // nothing chained
  });

  it("does not chain an order whose guarded flip matched 0 rows (raced to fulfilled elsewhere)", async () => {
    const { supabase, callsByTable } = makeSupabase({
      orders: [
        { data: [{ id: ORDER_A }], error: null },
        { data: [], error: null }, // guard matched 0 rows — no flip
      ],
    });

    const result = await runTransitionSideEffects(supabase, "deliveries", [DELIVERY_A], "completed");

    expect(result.error).toBeNull();
    expect(callsByTable.allocations).toBeUndefined(); // nothing chained
  });

  it("surfaces a linked-order read failure", async () => {
    const { supabase } = makeSupabase({
      orders: [{ data: null, error: { message: "boom" } }],
    });

    const result = await runTransitionSideEffects(supabase, "deliveries", [DELIVERY_A], "completed");

    expect(result.error).toContain("syncing its orders failed");
    expect(result.error).toContain("boom");
  });

  it("treats a null linked-order payload as no linked orders", async () => {
    // PostgREST can return data:null with no error; the `?? []` guard is what
    // stops the entry from throwing on .length.
    const { supabase, callsByTable } = makeSupabase({
      orders: [{ data: null, error: null }],
    });

    const result = await runTransitionSideEffects(supabase, "deliveries", [DELIVERY_A], "completed");

    expect(result.error).toBeNull();
    expect(callsByTable.orders).toHaveLength(1); // read only
    expect(callsByTable.allocations).toBeUndefined(); // nothing chained
  });

  it("does not chain an order whose flip returned a null payload", async () => {
    // Same guard on the UPDATE ... .select("id") result: only rows we can SEE
    // flipped may be chained, or we would synthesize removals for an order
    // that never actually moved to fulfilled.
    const { supabase, callsByTable } = makeSupabase({
      orders: [
        { data: [{ id: ORDER_A }], error: null },
        { data: null, error: null }, // flip: no rows returned
      ],
    });

    const result = await runTransitionSideEffects(supabase, "deliveries", [DELIVERY_A], "completed");

    expect(result.error).toBeNull();
    expect(callsByTable.allocations).toBeUndefined();
  });

  it("surfaces an error raised by the chained orders → fulfilled effect", async () => {
    const { supabase } = makeSupabase({
      orders: [
        { data: [{ id: ORDER_A }], error: null },
        { data: [{ id: ORDER_A }], error: null }, // flip succeeds
      ],
      // The chained fulfillment effect's reservation read fails.
      allocations: [{ data: null, error: { message: "chain boom" } }],
    });

    const result = await runTransitionSideEffects(supabase, "deliveries", [DELIVERY_A], "completed");

    // The delivery still completed; the chained failure is nested, not lost.
    expect(result.error).toContain("Delivery completed, but");
    expect(result.error).toContain("completing its inventory reservations failed");
    expect(result.error).toContain("chain boom");
  });
});

// =============================================================================
// pick_lists: null payload guard
// =============================================================================

describe("runTransitionSideEffects: pick_lists null payload", () => {
  it("treats a null pick-list payload as no rows and skips the orders update", async () => {
    const mock = createMockSupabase({ data: null, error: null });

    const result = await runTransitionSideEffects(
      mock.client,
      "pick_lists",
      [PICK_LIST_ID],
      "in_progress"
    );

    expect(result.error).toBeNull();
    expect(mock.from).not.toHaveBeenCalledWith("orders");
  });
});

// =============================================================================
// packaging_sessions → completed (BOM material depletion)
// =============================================================================

const SESSION_A = "00000000-0000-0000-0000-0000000000s1";
const SESSION_B = "00000000-0000-0000-0000-0000000000s2";

describe("runTransitionSideEffects: packaging_sessions → completed", () => {
  it("depletes each completed session's packaging-material BOM", async () => {
    const { supabase } = makeSupabase({});
    vi.mocked(consumePackagingMaterials).mockResolvedValue({
      success: true,
      data: { allocations_inserted: 3, shortfalls: [] },
      invalidate: [],
    });

    const result = await runTransitionSideEffects(
      supabase,
      "packaging_sessions",
      [SESSION_A, SESSION_B],
      "completed"
    );

    expect(result.error).toBeNull();
    expect(consumePackagingMaterials).toHaveBeenCalledWith(supabase, SESSION_A);
    expect(consumePackagingMaterials).toHaveBeenCalledWith(supabase, SESSION_B);
  });

  it("surfaces depletion failures once, deduped, without failing the session", async () => {
    const { supabase } = makeSupabase({});
    vi.mocked(consumePackagingMaterials).mockResolvedValue({
      success: false,
      error: { code: "UNKNOWN", message: "no lot for CAN-12OZ" },
    });

    const result = await runTransitionSideEffects(
      supabase,
      "packaging_sessions",
      [SESSION_A, SESSION_B],
      "completed"
    );

    expect(result.error).toContain("Session completed, but material depletion failed");
    expect(result.error).toContain("no lot for CAN-12OZ");
    // Both sessions failed identically — the message is deduped, not repeated.
    expect(result.error?.match(/no lot for CAN-12OZ/g)).toHaveLength(1);
  });

  it("does nothing for packaging_sessions transitions without registered effects", async () => {
    const { supabase } = makeSupabase({});
    vi.mocked(consumePackagingMaterials).mockClear();

    const result = await runTransitionSideEffects(
      supabase,
      "packaging_sessions",
      [SESSION_A],
      "in_progress"
    );

    expect(result.error).toBeNull();
    expect(consumePackagingMaterials).not.toHaveBeenCalled();
  });
});

// =============================================================================
// batches → completed: consumption + vessel-release failure paths
// =============================================================================

describe("runTransitionSideEffects: batches → completed (failure paths)", () => {
  it("surfaces consumption AND vessel-release failures together, and skips the vessel cache refresh", async () => {
    const { supabase } = makeSupabase({
      vessels: [{ data: null, error: { message: "vessel locked" } }],
    });
    const { queryClient, invalidateQueries } = createMockQueryClient();
    vi.mocked(completeBatchConsumption).mockResolvedValue({
      success: false,
      error: { code: "UNKNOWN", message: "no planned allocations" },
    });
    vi.mocked(reconcileBatchLoss).mockResolvedValue({ success: true, data: 0, invalidate: [] });

    const result = await runTransitionSideEffects(
      supabase,
      "batches",
      [BATCH_A, BATCH_B],
      "completed",
      queryClient
    );

    // The batch is still completed; both failures are reported in one message.
    expect(result.error).toContain("Batch completed, but");
    expect(result.error).toContain("confirming ingredient consumption failed");
    expect(result.error).toContain("no planned allocations");
    expect(result.error).toContain("releasing the vessel failed: vessel locked");
    // Identical per-batch failures are deduped.
    expect(result.error?.match(/no planned allocations/g)).toHaveLength(1);
    // No allocations were confirmed, so the count stays 0.
    expect(result.completedAllocations).toBe(0);
    // The vessel UPDATE failed → its caches must NOT be invalidated (that
    // would paint a released vessel that is still occupied).
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["vessels"] });
  });
});

// =============================================================================
// orders → fulfilled: reservation-completion edge cases
// =============================================================================

describe("runTransitionSideEffects: orders → fulfilled (reservation edge cases)", () => {
  it("skips the container-volume lookup entirely when no reservation names a source lot", async () => {
    // No finished_goods queue is provided: the fake throws if the lookup runs.
    const { supabase, callsByTable } = makeSupabase({
      allocations: [
        { data: [{ id: "a1", source_id: null, quantity: 5, destination_id: ORDER_A }], error: null },
        { data: null, error: null }, // update a1
      ],
    });

    const result = await runTransitionSideEffects(supabase, "orders", [ORDER_A], "fulfilled");

    expect(callsByTable.finished_goods).toBeUndefined();
    // Still completed — the shipment happened — but with no volume, flagged.
    expect(callsByTable.allocations[1].update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed", volume_bbl: null })
    );
    expect(result.error).toContain("no container volume data");
  });

  it("completes reservations with null volume and a distinct warning when the volume LOOKUP fails", async () => {
    const { supabase, callsByTable } = makeSupabase({
      allocations: [
        { data: [{ id: "a1", source_id: "fg-1", quantity: 10, destination_id: ORDER_A }], error: null },
        { data: null, error: null }, // update a1
      ],
      finished_goods: [{ data: null, error: { message: "statement timeout" } }],
    });

    const result = await runTransitionSideEffects(supabase, "orders", [ORDER_A], "fulfilled");

    expect(callsByTable.allocations[1].update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed", volume_bbl: null })
    );
    expect(result.error).toContain("looking up container volumes failed");
    expect(result.error).toContain("statement timeout");
    // A lookup FAILURE is reported instead of (not in addition to) the
    // missing-data message — they have different remedies.
    expect(result.error).not.toContain("no container volume data");
  });

  it("completes with null volume when the finished good has no selling-format join", async () => {
    const { supabase, callsByTable } = makeSupabase({
      allocations: [
        { data: [{ id: "a1", source_id: "fg-x", quantity: 4, destination_id: ORDER_A }], error: null },
        { data: null, error: null },
      ],
      finished_goods: [{ data: [{ id: "fg-x", selling_format: null }], error: null }],
    });

    const result = await runTransitionSideEffects(supabase, "orders", [ORDER_A], "fulfilled");

    expect(callsByTable.allocations[1].update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed", volume_bbl: null })
    );
    expect(result.error).toContain("1 reservation(s) have no container volume data");
  });

  it("surfaces a rejected reservation UPDATE while still attempting the others", async () => {
    const { supabase, callsByTable } = makeSupabase({
      allocations: [
        {
          data: [
            { id: "a1", source_id: "fg-1", quantity: 2, destination_id: ORDER_A },
            { id: "a2", source_id: "fg-1", quantity: 3, destination_id: ORDER_A },
          ],
          error: null,
        },
        { data: null, error: { message: "guard_finished_good_outbound tripped" } }, // a1 rejected
        { data: null, error: null }, // a2 succeeds
      ],
      finished_goods: [
        {
          data: [
            {
              id: "fg-1",
              selling_format: { unit_count: 1, container: { volume_bbl: 0.5, volume_oz: null } },
            },
          ],
          error: null,
        },
      ],
    });

    const result = await runTransitionSideEffects(supabase, "orders", [ORDER_A], "fulfilled");

    expect(result.error).toContain("completing 1 reservation(s) failed");
    expect(result.error).toContain("guard_finished_good_outbound tripped");
    // Per-row updates: a2 still ran despite a1's rejection.
    expect(callsByTable.allocations[2].update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed", volume_bbl: 1.5 })
    );
  });

  it("treats a null reservation payload as no reservations and falls through to synthesis", async () => {
    const { supabase, callsByTable } = makeSupabase({
      allocations: [
        { data: null, error: null }, // planned read: null payload, no error
        { data: [], error: null }, // synthesis guard read
      ],
      order_items: [{ data: [], error: null }],
    });

    const result = await runTransitionSideEffects(supabase, "orders", [ORDER_A], "fulfilled");

    expect(result.error).toBeNull();
    expect(callsByTable.order_items).toHaveLength(1);
  });
});

// =============================================================================
// orders → fulfilled: synthesis failure / guard paths (BD-5)
// =============================================================================

/** One non-keg case line for ORDER_A, used by the synthesis failure tests. */
const CASE_ITEM = {
  id: ITEM_1,
  order_id: ORDER_A,
  brand_id: BRAND_1,
  selling_format_id: "sf-case",
  quantity: 10,
};

const CASE_FORMAT = {
  id: "sf-case",
  unit_count: 1,
  container: { type: "can", volume_bbl: null, volume_oz: 3968 },
};

describe("runTransitionSideEffects: orders → fulfilled (synthesis failure paths)", () => {
  it("surfaces a failed idempotency-guard read and never reads the line items", async () => {
    const { supabase, callsByTable } = makeSupabase({
      allocations: [
        { data: [], error: null }, // planned read
        { data: null, error: { message: "guard read boom" } },
      ],
    });

    const result = await runTransitionSideEffects(supabase, "orders", [ORDER_A], "fulfilled");

    expect(result.error).toContain("synthesizing removal allocations failed");
    expect(result.error).toContain("guard read boom");
    // Bailing BEFORE reading order_items matters: without the guard read we
    // cannot know which lines were already synthesized, so re-inserting would
    // double-count removals.
    expect(callsByTable.order_items).toBeUndefined();
  });

  it("surfaces a failed order_items read and never reads the selling formats", async () => {
    const { supabase, callsByTable } = makeSupabase({
      allocations: [
        { data: [], error: null },
        { data: [], error: null },
      ],
      order_items: [{ data: null, error: { message: "items boom" } }],
    });

    const result = await runTransitionSideEffects(supabase, "orders", [ORDER_A], "fulfilled");

    expect(result.error).toContain("synthesizing removal allocations failed");
    expect(result.error).toContain("items boom");
    expect(callsByTable.selling_formats).toBeUndefined();
  });

  it("surfaces a failed selling_formats read and never reads the lots", async () => {
    const { supabase, callsByTable } = makeSupabase({
      allocations: [
        { data: [], error: null },
        { data: [], error: null },
      ],
      order_items: [{ data: [CASE_ITEM], error: null }],
      selling_formats: [{ data: null, error: { message: "formats boom" } }],
    });

    const result = await runTransitionSideEffects(supabase, "orders", [ORDER_A], "fulfilled");

    expect(result.error).toContain("formats boom");
    // Without formats we cannot tell keg lines apart — drawing lots anyway
    // would risk double-attributing a keg shipment.
    expect(callsByTable.finished_goods).toBeUndefined();
  });

  it("surfaces a failed lot read and inserts nothing", async () => {
    const { supabase, callsByTable } = makeSupabase({
      allocations: [
        { data: [], error: null },
        { data: [], error: null },
      ],
      order_items: [{ data: [CASE_ITEM], error: null }],
      selling_formats: [{ data: [CASE_FORMAT], error: null }],
      finished_goods: [{ data: null, error: { message: "lots boom" } }],
    });

    const result = await runTransitionSideEffects(supabase, "orders", [ORDER_A], "fulfilled");

    expect(result.error).toContain("lots boom");
    expect(callsByTable.allocations).toHaveLength(2); // reads only, no inserts
  });

  it("surfaces a failed per-lot availability read and inserts nothing", async () => {
    const { supabase, callsByTable } = makeSupabase({
      allocations: [
        { data: [], error: null },
        { data: [], error: null },
        { data: null, error: { message: "availability boom" } },
      ],
      order_items: [{ data: [CASE_ITEM], error: null }],
      selling_formats: [{ data: [CASE_FORMAT], error: null }],
      finished_goods: [
        {
          data: [
            {
              id: "fg-1",
              brand_id: BRAND_1,
              selling_format_id: "sf-case",
              quantity: 50,
              production_date: "2026-01-01",
              lot_number: "L1",
            },
          ],
          error: null,
        },
      ],
    });

    const result = await runTransitionSideEffects(supabase, "orders", [ORDER_A], "fulfilled");

    // Without per-lot availability we would be drawing blind — bail rather
    // than insert rows the 00212 guard would reject anyway.
    expect(result.error).toContain("availability boom");
    expect(callsByTable.allocations).toHaveLength(3); // no inserts
  });

  it("skips (and flags) lines with no selling format, without querying formats", async () => {
    const { supabase, callsByTable } = makeSupabase({
      allocations: [
        { data: [], error: null },
        { data: [], error: null },
      ],
      order_items: [
        { data: [{ ...CASE_ITEM, selling_format_id: null }], error: null },
      ],
    });

    const result = await runTransitionSideEffects(supabase, "orders", [ORDER_A], "fulfilled");

    expect(result.error).toContain("1 order line(s) have no selling format and were skipped");
    // Every line was skipped → no format/lot queries and no inserts.
    expect(callsByTable.selling_formats).toBeUndefined();
    expect(callsByTable.allocations).toHaveLength(2);
  });

  it("synthesizes nothing for a keg-only order (kegs belong to the keg_transactions ledger)", async () => {
    const { supabase, callsByTable } = makeSupabase({
      allocations: [
        { data: [], error: null },
        { data: [], error: null },
      ],
      order_items: [
        { data: [{ ...CASE_ITEM, id: ITEM_KEG, selling_format_id: "sf-keg" }], error: null },
      ],
      selling_formats: [
        {
          data: [{ id: "sf-keg", unit_count: 1, container: { type: "keg", volume_bbl: 0.5, volume_oz: null } }],
          error: null,
        },
      ],
    });

    const result = await runTransitionSideEffects(supabase, "orders", [ORDER_A], "fulfilled");

    // A double FIFO over allocation-availability would misattribute the lot
    // the keg ledger already drew — so the run stops before touching lots.
    expect(result.error).toBeNull();
    expect(callsByTable.finished_goods).toBeUndefined();
    expect(callsByTable.allocations).toHaveLength(2); // no inserts
  });

  it("flags a shortfall (and skips the availability read) when the format has no lots at all", async () => {
    const { supabase, callsByTable } = makeSupabase({
      allocations: [
        { data: [], error: null },
        { data: [], error: null },
      ],
      order_items: [{ data: [CASE_ITEM], error: null }],
      selling_formats: [{ data: [CASE_FORMAT], error: null }],
      finished_goods: [{ data: [], error: null }], // nothing packaged
    });

    const result = await runTransitionSideEffects(supabase, "orders", [ORDER_A], "fulfilled");

    // Fulfillment stands; the uncovered quantity is surfaced, never silently
    // dropped and never inserted over availability.
    expect(result.error).toContain("Order fulfilled, but");
    expect(result.error).toContain("1 order line(s) exceed available finished-goods stock");
    // No lots → the per-lot availability read is pointless and must be skipped.
    expect(callsByTable.allocations).toHaveLength(2);
  });
});

// =============================================================================
// orders → fulfilled: synthesis draw ordering (FIFO + wildcard-brand rules)
// =============================================================================

const BRAND_2 = "00000000-0000-0000-0000-00000000br02";
const ITEM_NAMED = "i-named";
const ITEM_WILDCARD = "i-wildcard";
const ITEM_ORPHAN = "i-orphan"; // sorts before "i-wildcard" within the wildcard group

describe("runTransitionSideEffects: orders → fulfilled (synthesis draw ordering)", () => {
  it("plans named-brand lines before wildcard lines, draws lots FIFO with NULLs last, and flags orphan/volume-less lines", async () => {
    const { supabase, callsByTable } = makeSupabase({
      allocations: [
        { data: [], error: null }, // planned read → no reservations
        { data: [], error: null }, // synthesis guard read
        {
          // Per-lot active allocations. Two rows that must NOT affect
          // availability: one with a null source, one for an unrelated lot.
          data: [
            { source_id: null, quantity: 99 },
            { source_id: "fg-unrelated", quantity: 99 },
          ],
          error: null,
        },
        { data: null, error: null }, // insert 1
        { data: null, error: null }, // insert 2
      ],
      order_items: [
        {
          data: [
            // Wildcard (no brand) line — must plan AFTER the named line.
            {
              id: ITEM_WILDCARD,
              order_id: ORDER_A,
              brand_id: null,
              selling_format_id: "sf-case",
              quantity: 2,
            },
            // Named-brand line for BRAND_1.
            {
              id: ITEM_NAMED,
              order_id: ORDER_A,
              brand_id: BRAND_1,
              selling_format_id: "sf-case",
              quantity: 2,
            },
            // Line whose selling_format row is not returned (deleted / RLS
            // hidden) — must be skipped and flagged, not crash the run.
            {
              id: ITEM_ORPHAN,
              order_id: ORDER_A,
              brand_id: null,
              selling_format_id: "sf-missing",
              quantity: 1,
            },
          ],
          error: null,
        },
      ],
      selling_formats: [
        {
          // container present but volume-less → no per-unit fill volume.
          // "sf-missing" is deliberately absent from the response.
          data: [{ id: "sf-case", unit_count: 1, container: null }],
          error: null,
        },
      ],
      finished_goods: [
        {
          data: [
            // Null production_date → sorts LAST (NULLS LAST), so it must never
            // be drawn while dated lots remain.
            {
              id: "lot-nulldate",
              brand_id: BRAND_1,
              selling_format_id: "sf-case",
              quantity: 2,
              production_date: null,
              lot_number: "A",
            },
            // Same date as lot-dated-1 but a NULL lot_number → sorts after it.
            {
              id: "lot-nulllot",
              brand_id: BRAND_2,
              selling_format_id: "sf-case",
              quantity: 2,
              production_date: "2026-01-01",
              lot_number: null,
            },
            {
              id: "lot-dated-1",
              brand_id: BRAND_1,
              selling_format_id: "sf-case",
              quantity: 2,
              production_date: "2026-01-01",
              lot_number: "L1",
            },
          ],
          error: null,
        },
      ],
    });

    const result = await runTransitionSideEffects(supabase, "orders", [ORDER_A], "fulfilled");

    // Exactly two inserts: the named line and the wildcard line. The orphan
    // line draws nothing (its format — and therefore its lots — is unknown).
    expect(callsByTable.allocations).toHaveLength(5);

    // The NAMED line planned first and took its own brand's oldest dated lot.
    // Had the wildcard line planned first it would have swallowed lot-dated-1
    // and starved the named line — this is 00229's ordering rule.
    expect(callsByTable.allocations[3].insert).toHaveBeenCalledWith(
      expect.objectContaining({
        source_id: "lot-dated-1",
        destination_id: ORDER_A,
        quantity: 2,
        lot_number: "L1",
        status: "completed",
        volume_bbl: null, // no container volume → flagged below, not guessed
        idempotency_key: `order_fulfill:${ORDER_A}:${ITEM_NAMED}`,
      })
    );

    // The WILDCARD line then drew across brands: lot-dated-1 is exhausted, so
    // it took lot-nulllot (same date, NULL lot_number → ordered after
    // lot-dated-1) — NOT lot-nulldate, whose NULL production_date sorts last.
    expect(callsByTable.allocations[4].insert).toHaveBeenCalledWith(
      expect.objectContaining({
        source_id: "lot-nulllot",
        quantity: 2,
        lot_number: null,
        idempotency_key: `order_fulfill:${ORDER_A}:${ITEM_WILDCARD}`,
      })
    );

    // lot-nulldate (NULLS LAST) was never drawn.
    const drawnLots = callsByTable.allocations
      .slice(3)
      .map((b) => b.insert.mock.calls[0][0].source_id);
    expect(drawnLots).not.toContain("lot-nulldate");
    // The null-source / unrelated-lot allocation rows did not eat availability
    // (had they, lot-dated-1's 2 units would have been unavailable).
    expect(drawnLots).toContain("lot-dated-1");

    // Both warnings surface: 3 lines with no volume (2 volume-less format
    // lines + the orphan) and 1 uncoverable line (the orphan).
    expect(result.error).toContain("3 order line(s) have no container volume data");
    expect(result.error).toContain("1 order line(s) exceed available finished-goods stock");
  });
});
