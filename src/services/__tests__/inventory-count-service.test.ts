// @vitest-environment node
/**
 * Characterization tests for src/services/inventory-count-service.ts
 * (recordInventoryCount).
 *
 * The function takes a SupabaseClient as a parameter rather than importing
 * one at module scope, so no vi.mock() of a client module is needed — we
 * hand it a lightweight fake query-builder object that mimics the exact
 * chains the service calls:
 *   - allocations: .insert(payload) -> { error }
 *   - inventory_lots (read): .select().eq().single() -> { data, error }
 *   - inventory_lots (write): .update(payload).eq(id).eq(quantity CAS)
 *       .select("id") -> { data: rows, error }  (empty rows = lost-update
 *       conflict; see audit M15)
 *
 * These tests pin *current* behavior (including quirks), not aspirational
 * behavior — see inline QUIRK notes.
 *
 * Note: for new tests, prefer the shared table-keyed fake in
 * src/test/supabase-mock.ts (import from "@/test/supabase-mock"). The local
 * `makeSupabase` below predates that helper and exposes per-chain-step spies
 * (selectSpy/selectEqSpy/updateSpy/...) instead of the shared helper's
 * `callsByTable` shape; migrating it would touch every assertion in this
 * file for no behavior change, so it's left as-is. It still throws on any
 * unqueued/unexpected table, matching the shared helper's fail-loud contract.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { recordInventoryCount } from "../inventory-count-service";

type LotRow = { id: string; quantity: number; notes: string | null };

function makeSupabase(opts: {
  insertResult?: { error: unknown };
  selectResult?: { data: LotRow | null; error: unknown };
  /**
   * Result of the increase-path CAS write's terminal `.select("id")`. Default
   * models one row updated (CAS hit): `{ data: [{ id: "lot-1" }], error: null }`.
   * An empty `data` array models the lost-update conflict (CAS miss).
   */
  updateResult?: { data: { id: string }[] | null; error: unknown };
}) {
  const insertSpy = vi.fn(() => Promise.resolve(opts.insertResult ?? { error: null }));

  const singleSpy = vi.fn(() =>
    Promise.resolve(opts.selectResult ?? { data: null, error: null })
  );
  const selectEqSpy = vi.fn(() => ({ single: singleSpy }));
  const selectSpy = vi.fn(() => ({ eq: selectEqSpy }));

  // Write chain: .update(payload).eq("id", ...).eq("quantity", ...).select("id")
  const updateSelectSpy = vi.fn(() =>
    Promise.resolve(opts.updateResult ?? { data: [{ id: "lot-1" }], error: null })
  );
  const updateQtyEqSpy = vi.fn(() => ({ select: updateSelectSpy }));
  const updateIdEqSpy = vi.fn(() => ({ eq: updateQtyEqSpy }));
  const updateSpy = vi.fn((_payload: { quantity: number; notes: string }) => ({
    eq: updateIdEqSpy,
  }));

  const fromSpy = vi.fn((table: string) => {
    if (table === "allocations") {
      return { insert: insertSpy };
    }
    if (table === "inventory_lots") {
      return { select: selectSpy, update: updateSpy };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  const supabase = { from: fromSpy } as unknown as SupabaseClient<Database>;
  return {
    supabase,
    fromSpy,
    insertSpy,
    selectSpy,
    selectEqSpy,
    singleSpy,
    updateSpy,
    updateIdEqSpy,
    updateQtyEqSpy,
    updateSelectSpy,
  };
}

describe("recordInventoryCount", () => {
  describe("exact match (kind: none)", () => {
    it("returns ok with the plan and never touches supabase when counted equals expected", async () => {
      const { supabase, fromSpy } = makeSupabase({});

      const result = await recordInventoryCount(supabase, {
        lotId: "lot-1",
        expectedQuantity: 10,
        countedQuantity: 10,
        notes: null,
      });

      expect(result).toEqual({
        success: true,
        data: { kind: "none", delta: 0 },
        invalidate: [],
      });
      expect(fromSpy).not.toHaveBeenCalled();
    });
  });

  describe("shrinkage (kind: decrease)", () => {
    // No test in this describe advances timers — a single fixed clock for
    // the whole block is sufficient, so install/teardown once rather than
    // per-test.
    beforeAll(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));
    });
    afterAll(() => {
      vi.useRealTimers();
    });

    it("inserts a completed adjustment allocation with the shrinkage amount as a positive quantity", async () => {
      const { supabase, fromSpy, insertSpy } = makeSupabase({});

      const result = await recordInventoryCount(supabase, {
        lotId: "lot-1",
        expectedQuantity: 10,
        countedQuantity: 6,
        notes: "  spilled some  ",
      });

      expect(fromSpy).toHaveBeenCalledTimes(1);
      expect(fromSpy).toHaveBeenCalledWith("allocations");
      expect(insertSpy).toHaveBeenCalledWith({
        source_type: "inventory_lot",
        source_id: "lot-1",
        destination_type: "adjustment",
        destination_id: null,
        quantity: 4,
        status: "completed",
        completed_at: "2026-07-01T12:00:00.000Z",
        reason_code: "count_adjustment",
        notes: "spilled some",
      });
      expect(result).toEqual({
        success: true,
        data: { kind: "decrease", delta: 4 },
        invalidate: [],
      });
    });

    it("trims notes and stores null when notes is whitespace-only", async () => {
      const { supabase, insertSpy } = makeSupabase({});

      await recordInventoryCount(supabase, {
        lotId: "lot-1",
        expectedQuantity: 10,
        countedQuantity: 6,
        notes: "   ",
      });

      expect(insertSpy).toHaveBeenCalledWith(
        expect.objectContaining({ notes: null })
      );
    });

    it("stores null notes when notes is undefined", async () => {
      const { supabase, insertSpy } = makeSupabase({});

      await recordInventoryCount(supabase, {
        lotId: "lot-1",
        expectedQuantity: 10,
        countedQuantity: 6,
      });

      expect(insertSpy).toHaveBeenCalledWith(
        expect.objectContaining({ notes: null })
      );
    });

    it("returns a typed FK_VIOLATION error and does not touch inventory_lots when the insert fails with a 23503", async () => {
      const { supabase, fromSpy } = makeSupabase({
        insertResult: { error: { code: "23503", message: "fk boom" } },
      });

      const result = await recordInventoryCount(supabase, {
        lotId: "lot-1",
        expectedQuantity: 10,
        countedQuantity: 6,
      });

      expect(result).toEqual({
        success: false,
        error: { code: "FK_VIOLATION", message: "fk boom" },
      });
      // Only the allocations table was ever queried — the increase branch's
      // inventory_lots read/write never fires from a decrease-path error.
      expect(fromSpy).toHaveBeenCalledTimes(1);
    });

    it("maps an unrecognized error code to UNKNOWN with the error itself as cause", async () => {
      const raw = { code: "99999", message: "weird" };
      const { supabase } = makeSupabase({ insertResult: { error: raw } });

      const result = await recordInventoryCount(supabase, {
        lotId: "lot-1",
        expectedQuantity: 10,
        countedQuantity: 6,
      });

      expect(result).toEqual({
        success: false,
        error: { code: "UNKNOWN", message: "weird", cause: raw },
      });
    });
  });

  describe("found stock (kind: increase)", () => {
    // No test in this describe advances timers — a single fixed clock for
    // the whole block is sufficient, so install/teardown once rather than
    // per-test.
    beforeAll(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));
    });
    afterAll(() => {
      vi.useRealTimers();
    });

    it("reads the lot fresh, then updates quantity and appends an audit note to existing notes", async () => {
      const {
        supabase,
        fromSpy,
        selectSpy,
        selectEqSpy,
        updateSpy,
        updateIdEqSpy,
        updateQtyEqSpy,
      } = makeSupabase({
        selectResult: { data: { id: "lot-1", quantity: 10, notes: "prior note" }, error: null },
      });

      const result = await recordInventoryCount(supabase, {
        lotId: "lot-1",
        expectedQuantity: 10,
        countedQuantity: 14,
        notes: "found a case in the back",
      });

      expect(fromSpy).toHaveBeenNthCalledWith(1, "inventory_lots");
      expect(selectSpy).toHaveBeenCalledWith("id, quantity, notes");
      expect(selectEqSpy).toHaveBeenCalledWith("id", "lot-1");

      // Literal expected note (not derived via buildCountIncreaseNote/
      // appendLotNote — asserting against the same production helpers the
      // service calls would be tautological). Hard-coded from the pinned
      // system time (2026-07-01) and the fixture values above: delta = 14 -
      // 10 = 4, prior notes = "prior note".
      const expectedNotes =
        "prior note\n[2026-07-01] Count adjustment: +4 (counted 14, expected 10) — found a case in the back";

      expect(fromSpy).toHaveBeenNthCalledWith(2, "inventory_lots");
      expect(updateSpy).toHaveBeenCalledWith({
        quantity: 14, // lot.quantity (10) + delta (4)
        notes: expectedNotes,
      });
      expect(updateIdEqSpy).toHaveBeenCalledWith("id", "lot-1");
      // CAS guard: the write is filtered on the pre-image quantity we read.
      expect(updateQtyEqSpy).toHaveBeenCalledWith("quantity", 10);

      expect(result).toEqual({
        success: true,
        data: { kind: "increase", delta: 4 },
        invalidate: [],
      });
    });

    it("starts a fresh note (no leading newline) when the lot has no prior notes", async () => {
      const { supabase, updateSpy } = makeSupabase({
        selectResult: { data: { id: "lot-1", quantity: 5, notes: null }, error: null },
      });

      await recordInventoryCount(supabase, {
        lotId: "lot-1",
        expectedQuantity: 5,
        countedQuantity: 8,
      });

      const updateArg = updateSpy.mock.calls[0][0] as { notes: string };
      expect(updateArg.notes.startsWith("[2026-07-01] Count adjustment:")).toBe(true);
      expect(updateArg.notes.includes("\n")).toBe(false);
    });

    it("returns NOT_FOUND and never calls update when the lot read errors with PGRST116", async () => {
      const { supabase, updateSpy, fromSpy } = makeSupabase({
        selectResult: { data: null, error: { code: "PGRST116", message: "no rows" } },
      });

      const result = await recordInventoryCount(supabase, {
        lotId: "lot-missing",
        expectedQuantity: 5,
        countedQuantity: 8,
      });

      expect(result).toEqual({
        success: false,
        error: { code: "NOT_FOUND", table: "inventory_lots", id: "unknown" },
      });
      expect(updateSpy).not.toHaveBeenCalled();
      // Only the read call happened.
      expect(fromSpy).toHaveBeenCalledTimes(1);
    });

    it(
      "QUIRK: NOT_FOUND error omits the actual lot id — parseSupabaseError is not given " +
        "an `id` in context, so it falls back to the literal string 'unknown'",
      async () => {
        const { supabase } = makeSupabase({
          selectResult: { data: null, error: { code: "PGRST116", message: "no rows" } },
        });

        const result = await recordInventoryCount(supabase, {
          lotId: "lot-abc-123",
          expectedQuantity: 5,
          countedQuantity: 8,
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toMatchObject({ id: "unknown" });
        }
      }
    );

    it(
      "returns RLS_DENIED with the raw message when the lot update is denied",
      async () => {
        // Note: parseSupabaseError's 42501 branch (src/services/types.ts)
        // discards the `table`/`id` context entirely — RLS_DENIED carries
        // only { code, message }, so this test can't (and doesn't) assert
        // which table the denial came from.
        const { supabase, updateSpy } = makeSupabase({
          selectResult: { data: { id: "lot-1", quantity: 10, notes: null }, error: null },
          updateResult: { data: null, error: { code: "42501", message: "not allowed" } },
        });

        const result = await recordInventoryCount(supabase, {
          lotId: "lot-1",
          expectedQuantity: 10,
          countedQuantity: 12,
        });

        expect(updateSpy).toHaveBeenCalled();
        expect(result).toEqual({
          success: false,
          error: { code: "RLS_DENIED", message: "not allowed" },
        });
      }
    );

    it(
      "returns CONFLICT (lost-update) when the CAS write matches no rows — " +
        "the lot's quantity changed between our read and write (audit M15)",
      async () => {
        const { supabase, updateSpy } = makeSupabase({
          selectResult: { data: { id: "lot-1", quantity: 10, notes: null }, error: null },
          // CAS miss: `.eq("quantity", 10)` matched nothing because a concurrent
          // write moved the lot off 10. PostgREST returns an empty row set.
          updateResult: { data: [], error: null },
        });

        const result = await recordInventoryCount(supabase, {
          lotId: "lot-1",
          expectedQuantity: 10,
          countedQuantity: 12,
        });

        expect(updateSpy).toHaveBeenCalled();
        expect(result).toEqual({
          success: false,
          error: {
            code: "CONFLICT",
            currentVersion: 10, // the pre-image quantity we based the write on
            message:
              "This lot's on-hand changed while you were counting. Refresh and re-count.",
          },
        });
      }
    );
  });

  describe("input validation exceptions (thrown by planCountAdjustment, caught and wrapped)", () => {
    it("wraps a negative countedQuantity as an UNKNOWN service error and never touches supabase", async () => {
      const { supabase, fromSpy } = makeSupabase({});

      const result = await recordInventoryCount(supabase, {
        lotId: "lot-1",
        expectedQuantity: 10,
        countedQuantity: -1,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("UNKNOWN");
        expect(result.error).toMatchObject({
          message: "Failed to record count: Counted quantity cannot be negative",
        });
      }
      expect(fromSpy).not.toHaveBeenCalled();
    });

    it("wraps a non-finite expectedQuantity (NaN) as an UNKNOWN service error", async () => {
      const { supabase, fromSpy } = makeSupabase({});

      const result = await recordInventoryCount(supabase, {
        lotId: "lot-1",
        expectedQuantity: NaN,
        countedQuantity: 5,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toMatchObject({
          code: "UNKNOWN",
          message: "Failed to record count: Count quantities must be finite numbers",
        });
      }
      expect(fromSpy).not.toHaveBeenCalled();
    });

    it("QUIRK: a thrown non-Error value (e.g. a string) is stringified via String(e), not `.message`", async () => {
      const insertSpy = vi.fn(() => {
        throw "raw string boom";
      });
      const fromSpy = vi.fn((table: string) => {
        if (table === "allocations") return { insert: insertSpy };
        throw new Error(`unexpected table: ${table}`);
      });
      const supabase = { from: fromSpy } as unknown as SupabaseClient<Database>;

      const result = await recordInventoryCount(supabase, {
        lotId: "lot-1",
        expectedQuantity: 10,
        countedQuantity: 6,
      });

      expect(result).toEqual({
        success: false,
        error: {
          code: "UNKNOWN",
          message: "Failed to record count: raw string boom",
          cause: "raw string boom",
        },
      });
    });
  });
});
