// @vitest-environment node
/**
 * Transition Side Effects — pick_lists → orders status sync tests
 *
 * Verifies the registry entries that keep the parent order's status in step
 * with pick-list transitions (audit S3): starting a pick list moves its
 * order scheduled → picking, completing one moves it picking → packed.
 * Both UPDATEs must be status-guarded so mismatched/raced order states are
 * harmless 0-row no-ops that never trip the server-side transition
 * validator (migration 00143).
 *
 * Uses a mock Supabase client to isolate the registry logic.
 */

import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueryClient } from "@tanstack/react-query";
import type { Database } from "@/types/supabase";

// The batches/packaging entries call into consumption-service; mock it so
// importing the module under test never touches a real client.
vi.mock("../consumption-service", () => ({
  completeBatchConsumption: vi.fn(),
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
      "orders",
      [ORDER_A],
      "completed"
    );

    expect(result.error).toBeNull();
    expect(mock.from).not.toHaveBeenCalled();
  });
});
