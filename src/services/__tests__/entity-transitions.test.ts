// @vitest-environment node
/**
 * Entity State Transition Validation Tests
 *
 * Tests the entityService.transition() method from entity-service.ts.
 * Verifies that invalid transitions are rejected, terminal states are enforced,
 * concurrent update conflicts (PGRST116) are handled, and entities without
 * state machines return an appropriate error.
 *
 * Uses mock Supabase client to isolate the transition validation logic.
 */

import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import type { EntityConfig } from "@/types/entity";

// Mock the Supabase client module to prevent real connections
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

import { entityService } from "../entity-service";
import { batchEntity } from "@/entities/batch";
import { orderEntity } from "@/entities/order";
import { purchaseOrderEntity } from "@/entities/purchase-order";

// =============================================================================
// Mock Supabase Builder
// =============================================================================

/**
 * Creates a chainable mock Supabase query builder.
 * The `singleResult` controls what `.single()` resolves to.
 */
function createMockBuilder(singleResult: { data: unknown; error: unknown }) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(singleResult),
  };
  return builder;
}

/**
 * Creates a mock Supabase client where `.from()` returns a query builder.
 * Accepts separate builders for select (read) and update (write) operations
 * to simulate the two queries in entityService.transition().
 */
function createMockSupabase(
  selectResult: { data: unknown; error: unknown },
  updateResult?: { data: unknown; error: unknown }
) {
  // Track call count to return different builders for select vs update
  let callCount = 0;
  const selectBuilder = createMockBuilder(selectResult);
  const updateBuilder = updateResult
    ? createMockBuilder(updateResult)
    : createMockBuilder({ data: null, error: null });

  const client = {
    rpc: vi.fn().mockResolvedValue(
      updateResult
        ? {
            data: updateResult.data == null ? null : { record: updateResult.data },
            error: updateResult.error,
          }
        : { data: null, error: null }
    ),
    from: vi.fn(() => {
      callCount++;
      // First .from() call is the SELECT (fetch current state)
      // A second builder is retained to prove the service never performs a
      // direct UPDATE outside the transactional RPC.
      return callCount === 1 ? selectBuilder : updateBuilder;
    }),
  } as unknown as SupabaseClient<Database>;

  return { client, selectBuilder, updateBuilder };
}

// =============================================================================
// Test ID
// =============================================================================

const TEST_ID = "00000000-0000-0000-0000-000000000001";

// =============================================================================
// Batch Transitions
// =============================================================================

describe("Entity State Transitions", () => {
  describe("Batch transitions", () => {
    it("allows planned -> fermenting", async () => {
      const { client } = createMockSupabase(
        { data: { status: "planned" }, error: null },
        { data: { id: TEST_ID, status: "fermenting" }, error: null }
      );

      const result = await entityService.transition(client, batchEntity, TEST_ID, "fermenting");

      expect(result.success).toBe(true);
      if (result.success) {
        expect((result.data as Record<string, unknown>).status).toBe("fermenting");
      }
    });

    it("allows fermenting -> conditioning", async () => {
      const { client } = createMockSupabase(
        { data: { status: "fermenting" }, error: null },
        { data: { id: TEST_ID, status: "conditioning" }, error: null }
      );

      const result = await entityService.transition(client, batchEntity, TEST_ID, "conditioning");

      expect(result.success).toBe(true);
    });

    it("allows conditioning -> packaging", async () => {
      const { client } = createMockSupabase(
        { data: { status: "conditioning" }, error: null },
        { data: { id: TEST_ID, status: "packaging" }, error: null }
      );

      const result = await entityService.transition(client, batchEntity, TEST_ID, "packaging");

      expect(result.success).toBe(true);
    });

    it("allows packaging -> completed", async () => {
      const { client, updateBuilder } = createMockSupabase(
        { data: { status: "packaging" }, error: null },
        { data: { id: TEST_ID, status: "completed" }, error: null }
      );

      const result = await entityService.transition(client, batchEntity, TEST_ID, "completed");

      expect(result.success).toBe(true);
      expect(client.rpc).toHaveBeenCalledWith("transition_entity_atomic", {
        p_table_name: "batches",
        p_id: TEST_ID,
        p_from_state: "packaging",
        p_to_state: "completed",
        p_extra_fields: {},
      });
      expect(updateBuilder.update).not.toHaveBeenCalled();
    });

    it("sends pre-transition fields inside the atomic command", async () => {
      const { client } = createMockSupabase(
        { data: { status: "packaging" }, error: null },
        { data: { id: TEST_ID, status: "completed", actual_fg: 1.012 }, error: null }
      );

      const result = await entityService.transition(
        client,
        batchEntity,
        TEST_ID,
        "completed",
        { actual_fg: 1.012 }
      );

      expect(result.success).toBe(true);
      expect(client.rpc).toHaveBeenCalledWith(
        "transition_entity_atomic",
        expect.objectContaining({ p_extra_fields: { actual_fg: 1.012 } })
      );
    });

    it("does not commit completion when the transactional transition command fails", async () => {
      const { client, updateBuilder } = createMockSupabase(
        { data: { status: "packaging" }, error: null },
        { data: { id: TEST_ID, status: "completed" }, error: null }
      );
      const rpc = vi.fn().mockResolvedValue({
        data: null,
        error: { code: "P0001", message: "ingredient consumption failed" },
      });
      Object.assign(client, { rpc });

      const result = await entityService.transition(client, batchEntity, TEST_ID, "completed");

      expect(result.success).toBe(false);
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(updateBuilder.update).not.toHaveBeenCalled();
    });

    it("rejects planned -> completed (skip states)", async () => {
      const { client } = createMockSupabase(
        { data: { status: "planned" }, error: null }
      );

      const result = await entityService.transition(client, batchEntity, TEST_ID, "completed");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_TRANSITION");
        if (result.error.code === "INVALID_TRANSITION") {
          expect(result.error.from).toBe("planned");
          expect(result.error.to).toBe("completed");
        }
      }
    });

    it("rejects planned -> packaging (skip states)", async () => {
      const { client } = createMockSupabase(
        { data: { status: "planned" }, error: null }
      );

      const result = await entityService.transition(client, batchEntity, TEST_ID, "packaging");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_TRANSITION");
      }
    });

    it("rejects transition from terminal state (completed)", async () => {
      const { client } = createMockSupabase(
        { data: { status: "completed" }, error: null }
      );

      const result = await entityService.transition(client, batchEntity, TEST_ID, "fermenting");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_TRANSITION");
        if (result.error.code === "INVALID_TRANSITION") {
          expect(result.error.from).toBe("completed");
        }
      }
    });

    it("rejects transition from terminal state (cancelled)", async () => {
      const { client } = createMockSupabase(
        { data: { status: "cancelled" }, error: null }
      );

      const result = await entityService.transition(client, batchEntity, TEST_ID, "planned");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_TRANSITION");
      }
    });

    it("rejects transition from terminal state (archived)", async () => {
      const { client } = createMockSupabase(
        { data: { status: "archived" }, error: null }
      );

      const result = await entityService.transition(client, batchEntity, TEST_ID, "fermenting");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_TRANSITION");
      }
    });

    it("handles concurrent state change (PGRST116)", async () => {
      const { client } = createMockSupabase(
        { data: { status: "planned" }, error: null },
        { data: null, error: { code: "PGRST116", message: "No rows returned" } }
      );

      const result = await entityService.transition(client, batchEntity, TEST_ID, "fermenting");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_TRANSITION");
        if (result.error.code === "INVALID_TRANSITION") {
          expect(result.error.message).toContain("concurrently");
        }
      }
    });

    it("allows planned -> cancelled", async () => {
      const { client } = createMockSupabase(
        { data: { status: "planned" }, error: null },
        { data: { id: TEST_ID, status: "cancelled" }, error: null }
      );

      const result = await entityService.transition(client, batchEntity, TEST_ID, "cancelled");

      expect(result.success).toBe(true);
    });
  });

  // ===========================================================================
  // Order Transitions
  // ===========================================================================

  describe("Order transitions", () => {
    it("allows draft -> confirmed", async () => {
      const { client } = createMockSupabase(
        { data: { status: "draft" }, error: null },
        { data: { id: TEST_ID, status: "confirmed" }, error: null }
      );

      const result = await entityService.transition(client, orderEntity, TEST_ID, "confirmed");

      expect(result.success).toBe(true);
    });

    it("allows the full lifecycle: draft -> confirmed -> scheduled -> picking -> packed -> fulfilled", async () => {
      const states = ["draft", "confirmed", "scheduled", "picking", "packed", "fulfilled"];

      for (let i = 0; i < states.length - 1; i++) {
        const from = states[i];
        const to = states[i + 1];

        const { client } = createMockSupabase(
          { data: { status: from }, error: null },
          { data: { id: TEST_ID, status: to }, error: null }
        );

        const result = await entityService.transition(client, orderEntity, TEST_ID, to);
        expect(result.success).toBe(true);
      }
    });

    it("rejects fulfilled -> draft (backward)", async () => {
      const { client } = createMockSupabase(
        { data: { status: "fulfilled" }, error: null }
      );

      const result = await entityService.transition(client, orderEntity, TEST_ID, "draft");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_TRANSITION");
        if (result.error.code === "INVALID_TRANSITION") {
          expect(result.error.from).toBe("fulfilled");
          expect(result.error.to).toBe("draft");
        }
      }
    });

    it("rejects draft -> fulfilled (skip states)", async () => {
      const { client } = createMockSupabase(
        { data: { status: "draft" }, error: null }
      );

      const result = await entityService.transition(client, orderEntity, TEST_ID, "fulfilled");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_TRANSITION");
      }
    });

    it("allows cancellation from non-terminal states", async () => {
      const cancellableStates = ["draft", "confirmed", "scheduled", "picking", "packed"];

      for (const state of cancellableStates) {
        const { client } = createMockSupabase(
          { data: { status: state }, error: null },
          { data: { id: TEST_ID, status: "cancelled" }, error: null }
        );

        const result = await entityService.transition(client, orderEntity, TEST_ID, "cancelled");
        expect(result.success).toBe(true);
      }
    });

    it("rejects cancellation from fulfilled (terminal)", async () => {
      const { client } = createMockSupabase(
        { data: { status: "fulfilled" }, error: null }
      );

      const result = await entityService.transition(client, orderEntity, TEST_ID, "cancelled");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_TRANSITION");
      }
    });

    it("handles concurrent state change (PGRST116)", async () => {
      const { client } = createMockSupabase(
        { data: { status: "draft" }, error: null },
        { data: null, error: { code: "PGRST116", message: "No rows returned" } }
      );

      const result = await entityService.transition(client, orderEntity, TEST_ID, "confirmed");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_TRANSITION");
        if (result.error.code === "INVALID_TRANSITION") {
          expect(result.error.message).toContain("concurrently");
        }
      }
    });
  });

  // ===========================================================================
  // Purchase Order Transitions
  // ===========================================================================

  describe("Purchase Order transitions", () => {
    it("allows draft -> submitted -> confirmed -> fulfilled", async () => {
      const path = ["draft", "submitted", "confirmed", "fulfilled"];

      for (let i = 0; i < path.length - 1; i++) {
        const from = path[i];
        const to = path[i + 1];

        const { client } = createMockSupabase(
          { data: { status: from }, error: null },
          { data: { id: TEST_ID, status: to }, error: null }
        );

        const result = await entityService.transition(
          client,
          purchaseOrderEntity,
          TEST_ID,
          to
        );
        expect(result.success).toBe(true);
      }
    });

    it("allows confirmed -> partial -> fulfilled (partial receipt path)", async () => {
      const path = ["confirmed", "partial", "fulfilled"];

      for (let i = 0; i < path.length - 1; i++) {
        const from = path[i];
        const to = path[i + 1];

        const { client } = createMockSupabase(
          { data: { status: from }, error: null },
          { data: { id: TEST_ID, status: to }, error: null }
        );

        const result = await entityService.transition(
          client,
          purchaseOrderEntity,
          TEST_ID,
          to
        );
        expect(result.success).toBe(true);
      }
    });

    it("allows fulfilled -> closed", async () => {
      const { client } = createMockSupabase(
        { data: { status: "fulfilled" }, error: null },
        { data: { id: TEST_ID, status: "closed" }, error: null }
      );

      const result = await entityService.transition(
        client,
        purchaseOrderEntity,
        TEST_ID,
        "closed"
      );

      expect(result.success).toBe(true);
    });

    it("rejects draft -> fulfilled (skip states)", async () => {
      const { client } = createMockSupabase(
        { data: { status: "draft" }, error: null }
      );

      const result = await entityService.transition(
        client,
        purchaseOrderEntity,
        TEST_ID,
        "fulfilled"
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_TRANSITION");
      }
    });

    it("rejects transition after closed (terminal)", async () => {
      const { client } = createMockSupabase(
        { data: { status: "closed" }, error: null }
      );

      const result = await entityService.transition(
        client,
        purchaseOrderEntity,
        TEST_ID,
        "draft"
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_TRANSITION");
        if (result.error.code === "INVALID_TRANSITION") {
          expect(result.error.from).toBe("closed");
        }
      }
    });

    it("rejects transition after cancelled (terminal)", async () => {
      const { client } = createMockSupabase(
        { data: { status: "cancelled" }, error: null }
      );

      const result = await entityService.transition(
        client,
        purchaseOrderEntity,
        TEST_ID,
        "draft"
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_TRANSITION");
      }
    });

    it("allows cancellation from draft through partial", async () => {
      const cancellableStates = ["draft", "submitted", "confirmed", "partial"];

      for (const state of cancellableStates) {
        const { client } = createMockSupabase(
          { data: { status: state }, error: null },
          { data: { id: TEST_ID, status: "cancelled" }, error: null }
        );

        const result = await entityService.transition(
          client,
          purchaseOrderEntity,
          TEST_ID,
          "cancelled"
        );
        expect(result.success).toBe(true);
      }
    });

    it("rejects cancellation from fulfilled or closed", async () => {
      for (const state of ["fulfilled", "closed"]) {
        const { client } = createMockSupabase(
          { data: { status: state }, error: null }
        );

        const result = await entityService.transition(
          client,
          purchaseOrderEntity,
          TEST_ID,
          "cancelled"
        );

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe("INVALID_TRANSITION");
        }
      }
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe("Edge cases", () => {
    it("returns error when entity has no state machine", async () => {
      const { client } = createMockSupabase(
        { data: {}, error: null }
      );

      // Create a minimal entity config without a state machine
      const noStateMachineEntity = {
        name: "widget",
        table: "widgets",
        displayName: "Widget",
        displayNamePlural: "Widgets",
        description: "A test entity without a state machine",
        domain: "production" as const,
        listColumns: [],
        defaultSort: { column: "id", direction: "asc" as const },
        searchableFields: [],
        sections: [],
        formSchema: { safeParse: () => ({ success: true, data: {} }) },
      } as unknown as EntityConfig<Record<string, unknown>>;

      const result = await entityService.transition(
        client,
        noStateMachineEntity,
        TEST_ID,
        "active"
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("UNKNOWN");
        if (result.error.code === "UNKNOWN") {
          expect(result.error.message).toContain("does not have a state machine");
        }
      }
    });

    it("returns error when record is not found (fetch fails)", async () => {
      const { client } = createMockSupabase(
        { data: null, error: { code: "PGRST116", message: "No rows returned" } }
      );

      const result = await entityService.transition(client, batchEntity, TEST_ID, "fermenting");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NOT_FOUND");
      }
    });

    it("rejects self-transition (same state)", async () => {
      const { client } = createMockSupabase(
        { data: { status: "fermenting" }, error: null }
      );

      const result = await entityService.transition(client, batchEntity, TEST_ID, "fermenting");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_TRANSITION");
      }
    });

    it("rejects transition to a non-existent state", async () => {
      const { client } = createMockSupabase(
        { data: { status: "planned" }, error: null }
      );

      const result = await entityService.transition(
        client,
        batchEntity,
        TEST_ID,
        "nonexistent_state"
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_TRANSITION");
      }
    });

    it("propagates unexpected Supabase errors on update", async () => {
      const { client } = createMockSupabase(
        { data: { status: "planned" }, error: null },
        { data: null, error: { code: "42501", message: "Insufficient privilege" } }
      );

      const result = await entityService.transition(client, batchEntity, TEST_ID, "fermenting");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("RLS_DENIED");
      }
    });
  });
});
