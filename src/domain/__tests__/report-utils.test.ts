// @vitest-environment node
/**
 * Characterization tests for src/domain/report-utils.ts
 * (fetchBatchIngredientDetail).
 *
 * The module takes a SupabaseClient as a function parameter rather than
 * importing one at module scope, so no vi.mock() of a client module is
 * needed — we just hand it a lightweight fake query-builder object that
 * mimics the `.from().select().eq().eq().in()` / `.from().select().in()`
 * chains it actually calls.
 */

import { describe, it, expect, vi } from "vitest";
import { fetchBatchIngredientDetail } from "@/domain/report-utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

type AllocRow = {
  id: string;
  quantity: number;
  unit_cost: number | null;
  source_id: string | null;
  source_type: string | null;
  lot_number: string | null;
};

type AllocationsResult = { data: AllocRow[] | null; error: unknown };
type LotsResult = { data: unknown[] | null; error: unknown };

/**
 * Builds a fake SupabaseClient whose `.from()` recognizes only the two
 * tables fetchBatchIngredientDetail queries. Each `.from()` call is
 * recorded on `fromSpy` so tests can assert whether the second
 * (inventory_lots) query happened at all, and the `in()` call on the
 * lots chain is recorded on `lotsInSpy` so tests can inspect the ids
 * actually requested (e.g. to confirm de-duplication via Set).
 */
function makeSupabase(opts: {
  allocations: AllocationsResult;
  lots?: LotsResult;
}) {
  const lotsInSpy = vi.fn(() =>
    Promise.resolve(opts.lots ?? { data: [], error: null }),
  );

  // Records the filters actually applied to the allocations chain, so the
  // status-semantics tests can assert WHICH statuses are summed rather than
  // only what comes back out of a fixture we control.
  const allocSelectSpy = vi.fn<(cols: string) => unknown>();
  const allocEqSpy = vi.fn<(col: string, val: unknown) => unknown>();
  const allocInSpy = vi.fn<(col: string, vals: unknown[]) => unknown>();

  const fromSpy = vi.fn((table: string) => {
    if (table === "allocations") {
      return {
        select: vi.fn((cols: string) => {
          allocSelectSpy(cols);
          return {
            eq: vi.fn((c1: string, v1: unknown) => {
              allocEqSpy(c1, v1);
              return {
                eq: vi.fn((c2: string, v2: unknown) => {
                  allocEqSpy(c2, v2);
                  return {
                    in: vi.fn((c3: string, v3: unknown[]) => {
                      allocInSpy(c3, v3);
                      return Promise.resolve(opts.allocations);
                    }),
                  };
                }),
              };
            }),
          };
        }),
      };
    }
    if (table === "inventory_lots") {
      return {
        select: vi.fn(() => ({
          in: lotsInSpy,
        })),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  const supabase = { from: fromSpy } as unknown as SupabaseClient<Database>;
  return {
    supabase,
    fromSpy,
    lotsInSpy,
    allocSelectSpy,
    allocEqSpy,
    allocInSpy,
  };
}

describe("fetchBatchIngredientDetail", () => {
  describe("early return / guard behavior", () => {
    it("returns [] and never touches supabase when batchId is null", async () => {
      const { supabase, fromSpy } = makeSupabase({
        allocations: { data: [], error: null },
      });

      const result = await fetchBatchIngredientDetail(supabase, null);

      expect(result).toEqual([]);
      expect(fromSpy).not.toHaveBeenCalled();
    });

    it("returns [] for an empty-string batchId (falsy check, not null check)", async () => {
      const { supabase, fromSpy } = makeSupabase({
        allocations: { data: [], error: null },
      });

      const result = await fetchBatchIngredientDetail(supabase, "");

      expect(result).toEqual([]);
      expect(fromSpy).not.toHaveBeenCalled();
    });
  });

  describe("allocations query outcomes", () => {
    it("throws the raw error object when the allocations query errors", async () => {
      const boom = new Error("allocations boom");
      const { supabase } = makeSupabase({
        allocations: { data: null, error: boom },
      });

      await expect(
        fetchBatchIngredientDetail(supabase, "batch-1"),
      ).rejects.toBe(boom);
    });

    it("returns [] when allocations data is null", async () => {
      const { supabase } = makeSupabase({
        allocations: { data: null, error: null },
      });

      const result = await fetchBatchIngredientDetail(supabase, "batch-1");
      expect(result).toEqual([]);
    });

    it("returns [] when allocations data is an empty array", async () => {
      const { supabase } = makeSupabase({
        allocations: { data: [], error: null },
      });

      const result = await fetchBatchIngredientDetail(supabase, "batch-1");
      expect(result).toEqual([]);
    });
  });

  describe("lot resolution and skip behavior", () => {
    it("does not query inventory_lots when no allocation is an inventory_lot with a source_id", async () => {
      const { supabase, fromSpy } = makeSupabase({
        allocations: {
          data: [
            {
              id: "alloc-1",
              quantity: 5,
              unit_cost: 2,
              source_id: null,
              source_type: "external",
              lot_number: null,
            },
          ],
          error: null,
        },
      });

      const result = await fetchBatchIngredientDetail(supabase, "batch-1");

      expect(fromSpy).toHaveBeenCalledTimes(1);
      expect(fromSpy).toHaveBeenCalledWith("allocations");
      expect(result).toEqual([
        {
          allocation_id: "alloc-1",
          ingredient_name: "External",
          quantity: 5,
          unit_cost: 2,
          total_cost: 10,
          lot_number: null,
        },
      ]);
    });

    it("resolves ingredient_name from the inventory_lots -> inventory_items join", async () => {
      const { supabase } = makeSupabase({
        allocations: {
          data: [
            {
              id: "alloc-1",
              quantity: 3,
              unit_cost: 4,
              source_id: "lot-1",
              source_type: "inventory_lot",
              lot_number: "L100",
            },
          ],
          error: null,
        },
        lots: {
          data: [{ id: "lot-1", inventory_item: { name: "Cascade Hops" } }],
          error: null,
        },
      });

      const result = await fetchBatchIngredientDetail(supabase, "batch-1");

      expect(result).toEqual([
        {
          allocation_id: "alloc-1",
          ingredient_name: "Cascade Hops",
          quantity: 3,
          unit_cost: 4,
          total_cost: 12,
          lot_number: "L100",
        },
      ]);
    });

    it('labels external-sourced allocations as "External"', async () => {
      const { supabase } = makeSupabase({
        allocations: {
          data: [
            {
              id: "alloc-1",
              quantity: 1,
              unit_cost: 9,
              source_id: null,
              source_type: "external",
              lot_number: null,
            },
          ],
          error: null,
        },
      });

      const result = await fetchBatchIngredientDetail(supabase, "batch-1");
      expect(result[0].ingredient_name).toBe("External");
    });

    it('labels allocations with an unrecognized source_type as "Unknown"', async () => {
      const { supabase } = makeSupabase({
        allocations: {
          data: [
            {
              id: "alloc-1",
              quantity: 1,
              unit_cost: 9,
              source_id: null,
              source_type: "manual_adjustment",
              lot_number: null,
            },
          ],
          error: null,
        },
      });

      const result = await fetchBatchIngredientDetail(supabase, "batch-1");
      expect(result[0].ingredient_name).toBe("Unknown");
    });

    it('falls back to "Unknown" (not "External") when source_type is inventory_lot but the lot id was not found in the lots response', async () => {
      const { supabase } = makeSupabase({
        allocations: {
          data: [
            {
              id: "alloc-1",
              quantity: 1,
              unit_cost: 9,
              source_id: "lot-missing",
              source_type: "inventory_lot",
              lot_number: null,
            },
          ],
          error: null,
        },
        lots: { data: [], error: null },
      });

      const result = await fetchBatchIngredientDetail(supabase, "batch-1");
      expect(result[0].ingredient_name).toBe("Unknown");
    });

    it("treats a null lots response (data: null) the same as an empty lot map", async () => {
      const { supabase } = makeSupabase({
        allocations: {
          data: [
            {
              id: "alloc-1",
              quantity: 1,
              unit_cost: 9,
              source_id: "lot-1",
              source_type: "inventory_lot",
              lot_number: null,
            },
          ],
          error: null,
        },
        lots: { data: null, error: null },
      });

      const result = await fetchBatchIngredientDetail(supabase, "batch-1");
      expect(result[0].ingredient_name).toBe("Unknown");
    });

    it("skips a lot row whose inventory_item join is null", async () => {
      const { supabase } = makeSupabase({
        allocations: {
          data: [
            {
              id: "alloc-1",
              quantity: 1,
              unit_cost: 9,
              source_id: "lot-1",
              source_type: "inventory_lot",
              lot_number: null,
            },
          ],
          error: null,
        },
        lots: {
          data: [{ id: "lot-1", inventory_item: null }],
          error: null,
        },
      });

      const result = await fetchBatchIngredientDetail(supabase, "batch-1");
      expect(result[0].ingredient_name).toBe("Unknown");
    });

    it("QUIRK: silently ignores an error on the inventory_lots query (no `error` field is checked, unlike the allocations query)", async () => {
      const { supabase } = makeSupabase({
        allocations: {
          data: [
            {
              id: "alloc-1",
              quantity: 2,
              unit_cost: 5,
              source_id: "lot-1",
              source_type: "inventory_lot",
              lot_number: null,
            },
          ],
          error: null,
        },
        lots: {
          data: [{ id: "lot-1", inventory_item: { name: "Pilsner Malt" } }],
          error: new Error("lots boom"),
        },
      });

      // Does not throw despite `error` being set on the lots response.
      const result = await fetchBatchIngredientDetail(supabase, "batch-1");
      expect(result[0].ingredient_name).toBe("Pilsner Malt");
    });

    it("QUIRK: an unrelated allocation row benefits from another row's resolved lot name if they share the same source_id, regardless of its own source_type", async () => {
      const { supabase } = makeSupabase({
        allocations: {
          data: [
            {
              id: "alloc-1",
              quantity: 1,
              unit_cost: 1,
              source_id: "lot-1",
              source_type: "inventory_lot",
              lot_number: null,
            },
            {
              id: "alloc-2",
              quantity: 1,
              unit_cost: 1,
              // Same source_id as alloc-1, but this row's own source_type
              // is not "inventory_lot" — the code only branches on
              // `source_id && lotNameMap.has(source_id)`, so it still
              // resolves to the lot name rather than "Unknown".
              source_id: "lot-1",
              source_type: "manual_adjustment",
              lot_number: null,
            },
          ],
          error: null,
        },
        lots: {
          data: [{ id: "lot-1", inventory_item: { name: "Crystal Malt" } }],
          error: null,
        },
      });

      const result = await fetchBatchIngredientDetail(supabase, "batch-1");
      expect(result[1].ingredient_name).toBe("Crystal Malt");
    });

    it("QUIRK: an array-shaped inventory_item join (rather than a single object) is treated as truthy, storing `.name` as undefined", async () => {
      const { supabase } = makeSupabase({
        allocations: {
          data: [
            {
              id: "alloc-1",
              quantity: 1,
              unit_cost: 1,
              source_id: "lot-1",
              source_type: "inventory_lot",
              lot_number: null,
            },
          ],
          error: null,
        },
        lots: {
          // Some PostgREST join shapes return an array instead of a
          // single object; the code blindly casts to `{ name } | null`
          // and treats a non-empty array as truthy.
          data: [{ id: "lot-1", inventory_item: [{ name: "Array Malt" }] }],
          error: null,
        },
      });

      const result = await fetchBatchIngredientDetail(supabase, "batch-1");
      expect(result[0].ingredient_name).toBeUndefined();
    });

    it("de-duplicates repeated source_ids before querying inventory_lots", async () => {
      const { supabase, lotsInSpy } = makeSupabase({
        allocations: {
          data: [
            {
              id: "alloc-1",
              quantity: 1,
              unit_cost: 1,
              source_id: "lot-1",
              source_type: "inventory_lot",
              lot_number: null,
            },
            {
              id: "alloc-2",
              quantity: 2,
              unit_cost: 1,
              source_id: "lot-1",
              source_type: "inventory_lot",
              lot_number: null,
            },
          ],
          error: null,
        },
        lots: {
          data: [{ id: "lot-1", inventory_item: { name: "Two-Row" } }],
          error: null,
        },
      });

      await fetchBatchIngredientDetail(supabase, "batch-1");

      expect(lotsInSpy).toHaveBeenCalledTimes(1);
      expect(lotsInSpy).toHaveBeenCalledWith("id", ["lot-1"]);
    });
  });

  describe("field pass-through and total_cost math", () => {
    it("computes total_cost as quantity * unit_cost", async () => {
      const { supabase } = makeSupabase({
        allocations: {
          data: [
            {
              id: "alloc-1",
              quantity: 2.5,
              unit_cost: 4,
              source_id: null,
              source_type: "external",
              lot_number: "L1",
            },
          ],
          error: null,
        },
      });

      const result = await fetchBatchIngredientDetail(supabase, "batch-1");
      expect(result[0].total_cost).toBe(10);
      expect(result[0].quantity).toBe(2.5);
      expect(result[0].unit_cost).toBe(4);
      expect(result[0].lot_number).toBe("L1");
    });

    it("treats a null unit_cost as 0 for total_cost while preserving unit_cost: null in the output", async () => {
      const { supabase } = makeSupabase({
        allocations: {
          data: [
            {
              id: "alloc-1",
              quantity: 7,
              unit_cost: null,
              source_id: null,
              source_type: "external",
              lot_number: null,
            },
          ],
          error: null,
        },
      });

      const result = await fetchBatchIngredientDetail(supabase, "batch-1");
      expect(result[0].total_cost).toBe(0);
      expect(result[0].unit_cost).toBeNull();
    });

    it("QUIRK: pins raw floating-point multiplication with no rounding applied", async () => {
      const { supabase } = makeSupabase({
        allocations: {
          data: [
            {
              id: "alloc-1",
              quantity: 0.1,
              unit_cost: 3,
              source_id: null,
              source_type: "external",
              lot_number: null,
            },
          ],
          error: null,
        },
      });

      const result = await fetchBatchIngredientDetail(supabase, "batch-1");
      // 0.1 * 3 in IEEE-754 doubles, not a clean 0.3.
      expect(result[0].total_cost).toBe(0.1 * 3);
      expect(result[0].total_cost).toBeCloseTo(0.3, 10);
    });

    it("preserves allocation order across multiple rows", async () => {
      const { supabase } = makeSupabase({
        allocations: {
          data: [
            {
              id: "alloc-1",
              quantity: 1,
              unit_cost: 1,
              source_id: null,
              source_type: "external",
              lot_number: null,
            },
            {
              id: "alloc-2",
              quantity: 2,
              unit_cost: 2,
              source_id: null,
              source_type: "manual",
              lot_number: null,
            },
            {
              id: "alloc-3",
              quantity: 3,
              unit_cost: 3,
              source_id: "lot-1",
              source_type: "inventory_lot",
              lot_number: null,
            },
          ],
          error: null,
        },
        lots: {
          data: [{ id: "lot-1", inventory_item: { name: "Yeast" } }],
          error: null,
        },
      });

      const result = await fetchBatchIngredientDetail(supabase, "batch-1");
      expect(result.map((r) => r.allocation_id)).toEqual([
        "alloc-1",
        "alloc-2",
        "alloc-3",
      ]);
      expect(result.map((r) => r.ingredient_name)).toEqual([
        "External",
        "Unknown",
        "Yeast",
      ]);
    });
  });

  /**
   * CHARACTERIZATION of the planned+completed cost semantics
   * (audit 2026-07-10 TC-12; 2026-07-06 Appendix G "flagged possible
   * planned-allocation double-count in report-utils.ts:31-35";
   * backlog item 24).
   *
   * These tests RECORD current behaviour, they do not endorse it. The query
   * sums allocations with status IN ('completed', 'planned') and returns them
   * as undifferentiated rows, so both the batch-cost and COGS report pages
   * (the only two callers) present planned spend and actual spend as one
   * number. Whether that is right is a product question nobody has answered;
   * what matters here is that a refactor cannot change it silently.
   */
  describe("planned + completed cost semantics (TC-12)", () => {
    it("filters allocations to exactly the statuses completed and planned, in that order", () => {
      // Pinning the literal array — not just its membership — because the
      // status set IS the semantics under discussion. Adding 'reserved', or
      // dropping 'planned', changes every COGS figure in the app.
      const { supabase, allocInSpy } = makeSupabase({
        allocations: { data: [], error: null },
      });
      return fetchBatchIngredientDetail(supabase, "batch-1").then(() => {
        expect(allocInSpy).toHaveBeenCalledTimes(1);
        expect(allocInSpy).toHaveBeenCalledWith("status", [
          "completed",
          "planned",
        ]);
      });
    });

    it("scopes the query to allocations whose DESTINATION is this batch", () => {
      // The batch is the destination, not the source: a batch-sourced
      // allocation (e.g. a transfer out of the batch) is deliberately not a
      // cost row here.
      const { supabase, allocEqSpy } = makeSupabase({
        allocations: { data: [], error: null },
      });
      return fetchBatchIngredientDetail(supabase, "batch-7").then(() => {
        expect(allocEqSpy).toHaveBeenNthCalledWith(1, "destination_type", "batch");
        expect(allocEqSpy).toHaveBeenNthCalledWith(2, "destination_id", "batch-7");
      });
    });

    it("KNOWN-IMPERFECT: a planned and a completed allocation on the SAME lot both count, summing to their total", async () => {
      // This is the flagged double-count. If a planned allocation of 10 units
      // is later realised as a completed allocation of 10 units on the same
      // lot WITHOUT the planned row being consumed or removed, the report
      // shows 20 units / $40 of an ingredient the batch used 10 / $20 of.
      // The suite has no opinion on whether the DB ever leaves both rows
      // standing — that is exactly the integration-tier question (backlog
      // item 21). What is pinned here is that report-utils applies NO
      // de-duplication, netting, or precedence of its own: whatever the two
      // rows are, they are both added.
      const { supabase } = makeSupabase({
        allocations: {
          data: [
            {
              id: "alloc-planned",
              quantity: 10,
              unit_cost: 2,
              source_id: "lot-1",
              source_type: "inventory_lot",
              lot_number: "L-1",
            },
            {
              id: "alloc-completed",
              quantity: 10,
              unit_cost: 2,
              source_id: "lot-1",
              source_type: "inventory_lot",
              lot_number: "L-1",
            },
          ],
          error: null,
        },
        lots: {
          data: [{ id: "lot-1", inventory_item: { name: "Pale Malt" } }],
          error: null,
        },
      });

      const result = await fetchBatchIngredientDetail(supabase, "batch-1");

      expect(result).toHaveLength(2);
      expect(result.map((r) => r.ingredient_name)).toEqual([
        "Pale Malt",
        "Pale Malt",
      ]);
      expect(result.reduce((sum, r) => sum + r.total_cost, 0)).toBe(40);
    });

    it("KNOWN-IMPERFECT: the returned rows carry no status, so no caller can separate planned from completed", async () => {
      // The root of TC-12. Because IngredientCostRow drops `status`, the
      // batch-cost and COGS pages CANNOT show planned and actual separately
      // even if they wanted to — the information is discarded here. Any real
      // fix starts by widening this row type, which will break this test.
      const { supabase } = makeSupabase({
        allocations: {
          data: [
            {
              id: "alloc-1",
              quantity: 1,
              unit_cost: 1,
              source_id: null,
              source_type: "external",
              lot_number: null,
            },
          ],
          error: null,
        },
      });

      const [row] = await fetchBatchIngredientDetail(supabase, "batch-1");

      expect(Object.keys(row).sort()).toEqual([
        "allocation_id",
        "ingredient_name",
        "lot_number",
        "quantity",
        "total_cost",
        "unit_cost",
      ]);
      expect(row).not.toHaveProperty("status");
    });

    it("KNOWN-IMPERFECT: does not request the status column at all", async () => {
      // Corollary of the above, and the cheapest tripwire: the select list
      // omits `status`, so the distinction is lost at the wire, not just in
      // the mapping. Adding it to the select is the first step of any fix.
      const { supabase, allocSelectSpy } = makeSupabase({
        allocations: { data: [], error: null },
      });

      await fetchBatchIngredientDetail(supabase, "batch-1");

      const cols = allocSelectSpy.mock.calls[0][0];
      expect(cols).not.toMatch(/\bstatus\b/);
      expect(cols).toBe(
        "id, quantity, unit_cost, source_id, source_type, lot_number",
      );
    });

    it("KNOWN-IMPERFECT: a planned allocation with a NULL unit_cost contributes 0, understating planned spend", async () => {
      // Planned allocations are the ones most likely to have no unit_cost yet
      // (the lot may not be priced). They are still counted as rows but at
      // $0, so the same figure that can DOUBLE-count priced planned spend can
      // simultaneously UNDER-count unpriced planned spend. Both directions
      // are pinned so neither can be "fixed" without noticing the other.
      const { supabase } = makeSupabase({
        allocations: {
          data: [
            {
              id: "alloc-planned-unpriced",
              quantity: 25,
              unit_cost: null,
              source_id: "lot-9",
              source_type: "inventory_lot",
              lot_number: "L-9",
            },
          ],
          error: null,
        },
        lots: {
          data: [{ id: "lot-9", inventory_item: { name: "Cascade" } }],
          error: null,
        },
      });

      const [row] = await fetchBatchIngredientDetail(supabase, "batch-1");

      expect(row.quantity).toBe(25);
      expect(row.unit_cost).toBeNull();
      expect(row.total_cost).toBe(0);
    });
  });
});
