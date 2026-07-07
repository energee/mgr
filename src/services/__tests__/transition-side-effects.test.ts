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
 */

import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueryClient } from "@tanstack/react-query";
import type { Database } from "@/types/supabase";
import { makeSupabase } from "@/test/supabase-mock";

// The batches/packaging entries call into consumption-service; mock it so
// importing the module under test never touches a real client.
vi.mock("../consumption-service", () => ({
  completeBatchConsumption: vi.fn(),
  reconcileBatchLoss: vi.fn(),
  consumePackagingMaterials: vi.fn(),
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
            { id: "a1", source_id: "fg-1", quantity: 10 },
            { id: "a2", source_id: "fg-2", quantity: 5 },
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
        { data: [{ id: "a1", source_id: "fg-1", quantity: 10 }], error: null },
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

  it("no-ops when the order has no planned reservations", async () => {
    // No finished_goods queue: the fake throws loudly if it gets queried.
    const { supabase, callsByTable } = makeSupabase({
      allocations: [{ data: [], error: null }],
    });

    const result = await runTransitionSideEffects(supabase, "orders", [ORDER_A], "fulfilled");

    expect(result.error).toBeNull();
    expect(callsByTable.allocations).toHaveLength(1); // read only, no updates
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
