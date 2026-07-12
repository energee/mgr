// @vitest-environment node

/**
 * Characterization tests for src/services/consumption-service.ts.
 *
 * All exported functions take a SupabaseClient as a parameter (never import
 * one at module scope), so no vi.mock() is needed — we hand each call the
 * shared fake query-builder client from "@/test/supabase-mock" (makeSupabase/
 * throwingSupabase). See that module's header for the fake's semantics:
 * table-keyed FIFO response queues, chain methods recorded as vi.fn calls
 * (assert query predicates via `callsByTable`), and `{ rejectWith }` queue
 * entries to model an async-rejecting query for catch-block coverage.
 *
 * Pure FIFO/scale/conversion math lives in src/domain/consumption-planning.ts
 * (and src/domain/units.ts) and is characterized separately — these tests
 * only cover this service's own orchestration: requirement aggregation,
 * inventory-item matching, shared-lot depletion across requirement lines,
 * query construction/branching, and insert-payload shaping.
 */

import { describe, it, expect } from "vitest";
import {
  buildBrewConsumptionPlan,
  createPlannedConsumption,
  completeBatchConsumption,
  consumePackagingMaterials,
  recordBatchLoss,
  reconcileBatchLoss,
  getBatchLossSummary,
  recordQuickDepletion,
  type ConfirmedConsumptionPick,
  type PackagingDepletionLineItem,
} from "@/services/consumption-service";
import { makeSupabase, throwingSupabase, type FakeResponse } from "@/test/supabase-mock";

type Resp = FakeResponse;

const emptyOk: Resp = { data: [], error: null };

/** Default empty responses for the 7 recipe/ingredient tables buildBrewConsumptionPlan reads via Promise.all. */
function recipeTables(overrides: Partial<Record<string, Resp>> = {}): Record<string, Resp[]> {
  return {
    recipes: [overrides.recipes ?? { data: { batch_size_bbl: null }, error: null }],
    recipe_malts: [overrides.recipe_malts ?? emptyOk],
    recipe_hops: [overrides.recipe_hops ?? emptyOk],
    recipe_adjuncts: [overrides.recipe_adjuncts ?? emptyOk],
    recipe_sugars: [overrides.recipe_sugars ?? emptyOk],
    recipe_spices: [overrides.recipe_spices ?? emptyOk],
    recipe_fruits: [overrides.recipe_fruits ?? emptyOk],
  };
}

// =============================================================================
// buildBrewConsumptionPlan
// =============================================================================

describe("buildBrewConsumptionPlan", () => {
  it("returns ok([]) and never queries inventory_items/lots when the recipe has no ingredient lines", async () => {
    const { supabase, fromSpy } = makeSupabase(recipeTables());

    const result = await buildBrewConsumptionPlan(supabase, "recipe-1", null);

    expect(result).toEqual({ success: true, data: [], invalidate: [] });
    const queriedTables = fromSpy.mock.calls.map((c) => c[0]);
    expect(queriedTables).not.toContain("inventory_items");
    expect(queriedTables).not.toContain("inventory_lots_with_quantities");
  });

  it("aggregates repeated ingredient lines (case-insensitive name match) into one summed requirement", async () => {
    // recipes has no batch_size_bbl and batchVolumeBbl is null -> scale 1.
    // inventory_items is queried once requirements is non-empty; no match configured.
    const { supabase } = makeSupabase({
      ...recipeTables({
        recipe_malts: {
          data: [
            { weight_lbs: 5, malt: { name: "Pale Malt" } },
            { weight_lbs: 3, malt: { name: "pale malt" } },
          ],
          error: null,
        },
      }),
      inventory_items: [emptyOk],
    });

    const result = await buildBrewConsumptionPlan(supabase, "recipe-1", null);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      ingredient_name: "Pale Malt",
      required_quantity: 8,
      inventory_item: null,
    });
  });

  it("applies the recipe scale factor (batchVolumeBbl / recipe batch_size_bbl) to required quantities", async () => {
    const { supabase } = makeSupabase({
      ...recipeTables({
        recipes: { data: { batch_size_bbl: 3 }, error: null },
        recipe_malts: { data: [{ weight_lbs: 2, malt: { name: "Vienna Malt" } }], error: null },
      }),
      inventory_items: [emptyOk],
    });

    const result = await buildBrewConsumptionPlan(supabase, "recipe-1", 15);

    expect(result.success).toBe(true);
    if (!result.success) return;
    // scale = 15 / 3 = 5; required = 2 * 5 = 10
    expect(result.data[0].required_quantity).toBe(10);
  });

  it("matches inventory items by name+category and suggests FIFO picks ordered by soonest expiration", async () => {
    const { supabase } = makeSupabase({
      ...recipeTables({
        recipes: { data: { batch_size_bbl: 5 }, error: null },
        recipe_malts: { data: [{ weight_lbs: 5, malt: { name: "2-Row" } }], error: null },
        recipe_hops: { data: [{ weight_oz: 2, hop: { name: "Cascade" } }], error: null },
      }),
      inventory_items: [
        {
          data: [
            { id: "grain-1", name: "2-Row", category: "grain", unit: "lbs" },
            { id: "hop-1", name: "Cascade", category: "hop", unit: "oz" },
          ],
          error: null,
        },
      ],
      inventory_lots_with_quantities: [
        {
          data: [
            {
              id: "lot-g-late",
              inventory_item_id: "grain-1",
              lot_number: "GL",
              remaining_quantity: 10,
              expiration_date: "2026-06-01",
              received_date: "2026-01-01",
              unit_cost: 1.5,
            },
            {
              id: "lot-g-early",
              inventory_item_id: "grain-1",
              lot_number: "GE",
              remaining_quantity: 10,
              expiration_date: "2025-06-01",
              received_date: "2025-01-01",
              unit_cost: 1.2,
            },
            {
              id: "lot-h1",
              inventory_item_id: "hop-1",
              lot_number: "H1",
              remaining_quantity: 4,
              expiration_date: null,
              received_date: "2025-01-01",
              unit_cost: 8,
            },
          ],
          error: null,
        },
      ],
    });

    // scale = batchVolumeBbl(10) / batch_size_bbl(5) = 2
    const result = await buildBrewConsumptionPlan(supabase, "recipe-1", 10);

    expect(result.success).toBe(true);
    if (!result.success) return;
    const malt = result.data.find((l) => l.ingredient_name === "2-Row");
    const hop = result.data.find((l) => l.ingredient_name === "Cascade");

    expect(malt).toMatchObject({
      required_quantity: 10, // 5 * scale(2)
      converted_quantity: 10,
      unit_mismatch: false,
      shortfall: 0,
    });
    // Soonest expiration first, even though it was listed second in the lots response.
    expect(malt?.picks).toEqual([
      { lot_id: "lot-g-early", lot_number: "GE", quantity: 10, unit_cost: 1.2 },
    ]);

    expect(hop).toMatchObject({ required_quantity: 4, converted_quantity: 4, shortfall: 0 });
    expect(hop?.picks).toEqual([{ lot_id: "lot-h1", lot_number: "H1", quantity: 4, unit_cost: 8 }]);
  });

  it("QUIRK: an unmatched ingredient (no inventory_item) reports shortfall 0, not the full required quantity", async () => {
    const { supabase } = makeSupabase({
      ...recipeTables({
        recipe_spices: {
          data: [{ amount: 5, unit: null, spice: { name: "Unmatched Herb" } }],
          error: null,
        },
      }),
      inventory_items: [emptyOk], // no match
    });

    const result = await buildBrewConsumptionPlan(supabase, "recipe-1", null);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual([
      {
        ingredient_name: "Unmatched Herb",
        catalog_type: "spice",
        required_quantity: 5,
        recipe_unit: "oz", // spice unit falls back to "oz" when null
        inventory_item: null,
        converted_quantity: 5, // falls back 1:1 since item is null
        unit_mismatch: false,
        picks: [],
        shortfall: 0, // QUIRK: not 5 — shortfall is only computed when an item was matched
      },
    ]);
  });

  it("sets unit_mismatch true and falls back to required_quantity 1:1 when units can't be converted", async () => {
    const { supabase } = makeSupabase({
      ...recipeTables({
        recipe_spices: {
          data: [{ amount: 3, unit: "unit", spice: { name: "Odd Spice" } }],
          error: null,
        },
      }),
      inventory_items: [
        { data: [{ id: "spice-1", name: "Odd Spice", category: "spice", unit: "each" }], error: null },
      ],
      inventory_lots_with_quantities: [emptyOk],
    });

    const result = await buildBrewConsumptionPlan(supabase, "recipe-1", null);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data[0]).toMatchObject({
      required_quantity: 3,
      converted_quantity: 3,
      unit_mismatch: true,
      picks: [],
      shortfall: 3, // item matched but no lots available -> fully unfilled
    });
  });

  it("depletes shared lots across two requirement lines matched to the same inventory item (no double-draw)", async () => {
    // Two spice lines with different recipe_unit spellings ("oz" vs "ounce")
    // hash to different requirement keys but resolve to the same inventory
    // item, exercising the "Deplete shared lots" comment in the source.
    const { supabase } = makeSupabase({
      ...recipeTables({
        recipe_spices: {
          data: [
            { amount: 30, unit: "oz", spice: { name: "Cinnamon" } },
            { amount: 30, unit: "ounce", spice: { name: "Cinnamon" } },
          ],
          error: null,
        },
      }),
      inventory_items: [
        { data: [{ id: "spice-1", name: "Cinnamon", category: "spice", unit: "oz" }], error: null },
      ],
      inventory_lots_with_quantities: [
        {
          data: [
            {
              id: "lot-s1",
              inventory_item_id: "spice-1",
              lot_number: "S1",
              remaining_quantity: 40,
              expiration_date: "2025-01-01",
              received_date: "2025-01-01",
              unit_cost: 3,
            },
          ],
          error: null,
        },
      ],
    });

    const result = await buildBrewConsumptionPlan(supabase, "recipe-1", null);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toHaveLength(2);
    // First line (unit "oz") draws 30 of the 40 available.
    expect(result.data[0].picks).toEqual([
      { lot_id: "lot-s1", lot_number: "S1", quantity: 30, unit_cost: 3 },
    ]);
    expect(result.data[0].shortfall).toBe(0);
    // Second line (unit "ounce", same converted quantity 30) only finds the
    // remaining 10 units in the shared lot -> partial pick + shortfall.
    expect(result.data[1].picks).toEqual([
      { lot_id: "lot-s1", lot_number: "S1", quantity: 10, unit_cost: 3 },
    ]);
    expect(result.data[1].shortfall).toBe(20);
  });

  it("returns err on a query error (e.g. the recipes lookup) without querying inventory_items", async () => {
    const boom = { code: "UNKNOWN", message: "recipe lookup failed" };
    const { supabase, fromSpy } = makeSupabase({
      ...recipeTables({
        recipes: { data: null, error: boom },
        recipe_malts: { data: [{ weight_lbs: 1, malt: { name: "X" } }], error: null },
      }),
    });

    const result = await buildBrewConsumptionPlan(supabase, "recipe-1", null);

    expect(result).toEqual({
      success: false,
      error: { code: "UNKNOWN", message: "recipe lookup failed", cause: boom },
    });
    expect(fromSpy.mock.calls.map((c) => c[0])).not.toContain("inventory_items");
  });

  it("returns err when the inventory_items lookup errors", async () => {
    const boom = { code: "UNKNOWN", message: "items lookup failed" };
    const { supabase } = makeSupabase({
      ...recipeTables({
        recipe_malts: { data: [{ weight_lbs: 1, malt: { name: "X" } }], error: null },
      }),
      inventory_items: [{ data: null, error: boom }],
    });

    const result = await buildBrewConsumptionPlan(supabase, "recipe-1", null);

    expect(result).toEqual({
      success: false,
      error: { code: "UNKNOWN", message: "items lookup failed", cause: boom },
    });
  });

  it("catches a synchronous throw and returns a wrapped UNKNOWN error", async () => {
    const { supabase } = throwingSupabase("recipes table exploded");

    const result = await buildBrewConsumptionPlan(supabase, "recipe-1", null);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("UNKNOWN");
    expect((result.error as { message: string }).message).toContain(
      "Failed to build consumption plan",
    );
    expect((result.error as { message: string }).message).toContain("recipes table exploded");
  });
});

// =============================================================================
// createPlannedConsumption
// =============================================================================

describe("createPlannedConsumption", () => {
  const pick = (over: Partial<ConfirmedConsumptionPick> = {}): ConfirmedConsumptionPick => ({
    lot_id: "lot-1",
    quantity: 5,
    unit_cost: 2,
    lot_number: "L1",
    ingredient_name: "2-Row",
    ...over,
  });

  it("filters out non-positive quantity picks and skips the insert entirely when none remain", async () => {
    const { supabase, fromSpy } = makeSupabase({});

    const result = await createPlannedConsumption(supabase, "batch-1", [
      pick({ quantity: 0 }),
      pick({ quantity: -1 }),
    ]);

    expect(result).toEqual({ success: true, data: 0, invalidate: [] });
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it("maps confirmed picks into planned allocation rows with a tagged note", async () => {
    const { supabase, callsByTable } = makeSupabase({
      allocations: [{ data: null, error: null }],
    });

    const result = await createPlannedConsumption(supabase, "batch-1", [
      pick({ lot_id: "lot-9", quantity: 3, unit_cost: 4, lot_number: "L9", ingredient_name: "Cascade" }),
    ]);

    expect(result).toEqual({ success: true, data: 1, invalidate: [] });
    const insertedRows = callsByTable.allocations[0].insert.mock.calls[0][0];
    expect(insertedRows).toEqual([
      {
        source_type: "inventory_lot",
        source_id: "lot-9",
        destination_type: "batch",
        destination_id: "batch-1",
        quantity: 3,
        unit_cost: 4,
        status: "planned",
        lot_number: "L9",
        notes: "Brew day consumption: Cascade",
      },
    ]);
  });

  it("returns a parsed error when the insert fails", async () => {
    const { supabase } = makeSupabase({
      allocations: [{ data: null, error: { code: "23503", message: "fk violation" } }],
    });

    const result = await createPlannedConsumption(supabase, "batch-1", [pick()]);

    expect(result).toEqual({
      success: false,
      error: { code: "FK_VIOLATION", message: "fk violation" },
    });
  });

  it("catches a synchronous throw and returns a wrapped UNKNOWN error", async () => {
    const { supabase } = throwingSupabase("insert exploded");

    const result = await createPlannedConsumption(supabase, "batch-1", [pick()]);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("UNKNOWN");
    expect((result.error as { message: string }).message).toContain(
      "Failed to create planned consumption",
    );
  });
});

// =============================================================================
// completeBatchConsumption
// =============================================================================

describe("completeBatchConsumption", () => {
  it("returns the number of allocations updated, and filters on the expected columns", async () => {
    const { supabase, callsByTable } = makeSupabase({
      allocations: [{ data: [{ id: "a1" }, { id: "a2" }], error: null }],
    });

    const result = await completeBatchConsumption(supabase, "batch-1");

    expect(result).toEqual({ success: true, data: 2, invalidate: [] });
    const builder = callsByTable.allocations[0];
    expect(builder.eq.mock.calls).toEqual([
      ["destination_type", "batch"],
      ["destination_id", "batch-1"],
      ["source_type", "inventory_lot"],
      ["status", "planned"],
    ]);
  });

  it("returns 0 when data is null", async () => {
    const { supabase } = makeSupabase({
      allocations: [{ data: null, error: null }],
    });

    const result = await completeBatchConsumption(supabase, "batch-1");
    expect(result).toEqual({ success: true, data: 0, invalidate: [] });
  });

  it("returns a parsed error when the update fails", async () => {
    const { supabase } = makeSupabase({
      allocations: [{ data: null, error: { message: "boom" } }],
    });

    const result = await completeBatchConsumption(supabase, "batch-1");
    expect(result).toEqual({ success: false, error: { code: "UNKNOWN", message: "boom", cause: { message: "boom" } } });
  });

  it("catches a synchronous throw and returns a wrapped UNKNOWN error", async () => {
    const { supabase } = throwingSupabase("update exploded");

    const result = await completeBatchConsumption(supabase, "batch-1");
    expect(result.success).toBe(false);
    if (result.success) return;
    expect((result.error as { message: string }).message).toContain(
      "Failed to complete batch consumption",
    );
  });
});

// =============================================================================
// consumePackagingMaterials
// =============================================================================

describe("consumePackagingMaterials", () => {
  it("idempotence guard: returns 0/[] without touching session_line_items when a tagged allocation already exists", async () => {
    const { supabase, fromSpy, callsByTable } = makeSupabase({
      allocations: [{ data: [{ id: "existing-1" }], error: null }],
    });

    const result = await consumePackagingMaterials(supabase, "session-1");

    expect(result).toEqual({
      success: true,
      data: { allocations_inserted: 0, shortfalls: [] },
      invalidate: [],
    });
    expect(fromSpy.mock.calls.map((c) => c[0])).toEqual(["allocations"]);
    // Pin the guard's filter, not just which table it queried.
    const guard = callsByTable.allocations[0];
    expect(guard.select).toHaveBeenCalledWith("id");
    // Guard keys on the stable idempotency_key column, not the mutable notes
    // string (audit #15).
    expect(guard.eq).toHaveBeenCalledWith("idempotency_key", "pkg_session:session-1");
    expect(guard.limit).toHaveBeenCalledWith(1);
  });

  it("returns a parsed error when the idempotence check errors", async () => {
    const { supabase } = makeSupabase({
      allocations: [{ data: null, error: { message: "check failed" } }],
    });

    const result = await consumePackagingMaterials(supabase, "session-1");
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toEqual({
      code: "UNKNOWN",
      message: "check failed",
      cause: { message: "check failed" },
    });
  });

  it("fetches session_line_items when preloadedLineItems is not passed, and returns err on fetch failure", async () => {
    const { supabase, fromSpy, callsByTable } = makeSupabase({
      allocations: [{ data: [], error: null }],
      session_line_items: [{ data: null, error: { message: "li failed" } }],
    });

    const result = await consumePackagingMaterials(supabase, "session-1");

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toEqual({
      code: "UNKNOWN",
      message: "li failed",
      cause: { message: "li failed" },
    });
    expect(fromSpy.mock.calls.map((c) => c[0])).toEqual(["allocations", "session_line_items"]);
    // The guard passed (no existing depletion) before proceeding to the line-item fetch.
    const guard = callsByTable.allocations[0];
    expect(guard.select).toHaveBeenCalledWith("id");
    // Guard keys on the stable idempotency_key column, not the mutable notes
    // string (audit #15).
    expect(guard.eq).toHaveBeenCalledWith("idempotency_key", "pkg_session:session-1");
    expect(guard.limit).toHaveBeenCalledWith(1);
  });

  it("returns 0/[] when there are no line items (fetched)", async () => {
    const { supabase } = makeSupabase({
      allocations: [{ data: [], error: null }],
      session_line_items: [{ data: [], error: null }],
    });

    const result = await consumePackagingMaterials(supabase, "session-1");
    expect(result).toEqual({
      success: true,
      data: { allocations_inserted: 0, shortfalls: [] },
      invalidate: [],
    });
  });

  it("returns 0/[] and skips the BOM query when every line item has a null selling_format_id", async () => {
    const { supabase, fromSpy } = makeSupabase({
      allocations: [{ data: [], error: null }],
    });
    const preloaded: PackagingDepletionLineItem[] = [
      { selling_format_id: null, actual_quantity: 5, batch_id: "batch-1" },
    ];

    const result = await consumePackagingMaterials(supabase, "session-1", preloaded);

    expect(result).toEqual({
      success: true,
      data: { allocations_inserted: 0, shortfalls: [] },
      invalidate: [],
    });
    expect(fromSpy.mock.calls.map((c) => c[0])).toEqual(["allocations"]);
  });

  it("returns err when the BOM lookup fails", async () => {
    const { supabase } = makeSupabase({
      allocations: [{ data: [], error: null }],
      selling_format_materials: [{ data: null, error: { message: "bom failed" } }],
    });
    const preloaded: PackagingDepletionLineItem[] = [
      { selling_format_id: "fmt-1", actual_quantity: 5, batch_id: "batch-1" },
    ];

    const result = await consumePackagingMaterials(supabase, "session-1", preloaded);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toEqual({
      code: "UNKNOWN",
      message: "bom failed",
      cause: { message: "bom failed" },
    });
  });

  it("returns 0/[] when the BOM has no rows for the requested formats", async () => {
    const { supabase } = makeSupabase({
      allocations: [{ data: [], error: null }],
      selling_format_materials: [{ data: [], error: null }],
    });
    const preloaded: PackagingDepletionLineItem[] = [
      { selling_format_id: "fmt-1", actual_quantity: 5, batch_id: "batch-1" },
    ];

    const result = await consumePackagingMaterials(supabase, "session-1", preloaded);
    expect(result).toEqual({
      success: true,
      data: { allocations_inserted: 0, shortfalls: [] },
      invalidate: [],
    });
  });

  it("groups by batch (null batch separate), draws FIFO across shared lots including across batch groups, and tags inserts with the session note", async () => {
    const preloaded: PackagingDepletionLineItem[] = [
      { selling_format_id: "fmt-1", actual_quantity: 5, batch_id: "batch-A" },
      { selling_format_id: "fmt-1", actual_quantity: 3, batch_id: "batch-A" },
      { selling_format_id: "fmt-1", actual_quantity: 2, batch_id: null },
    ];
    const { supabase, callsByTable } = makeSupabase({
      allocations: [{ data: [], error: null }, { data: null, error: null }],
      selling_format_materials: [
        {
          data: [
            {
              selling_format_id: "fmt-1",
              inventory_item_id: "cap-1",
              quantity_per_unit: 2,
              inventory_item: { unit: "oz" },
            },
          ],
          error: null,
        },
      ],
      inventory_lots_with_quantities: [
        {
          data: [
            {
              id: "lot-cap-1",
              inventory_item_id: "cap-1",
              lot_number: "C1",
              remaining_quantity: 10,
              expiration_date: "2025-01-01",
              received_date: "2025-01-01",
              unit_cost: 0.5,
            },
            {
              id: "lot-cap-2",
              inventory_item_id: "cap-1",
              lot_number: "C2",
              remaining_quantity: 20,
              expiration_date: "2026-01-01",
              received_date: "2026-01-01",
              unit_cost: 0.6,
            },
          ],
          error: null,
        },
      ],
    });

    const result = await consumePackagingMaterials(supabase, "session-42", preloaded);

    expect(result.success).toBe(true);
    if (!result.success) return;
    // batch-A needs (5+3)*2=16oz: 10 from lot-cap-1 + 6 from lot-cap-2.
    // null-batch needs 2*2=4oz: drawn from lot-cap-2's remaining 14 -> 4.
    expect(result.data).toEqual({ allocations_inserted: 3, shortfalls: [] });

    const insertedRows = callsByTable.allocations[1].insert.mock.calls[0][0];
    expect(insertedRows).toHaveLength(3);
    expect(insertedRows.every((r: { notes: string }) => r.notes === "Packaging session session-42 material consumption")).toBe(true);
    // Every row carries the stable idempotency_key the guard now matches on (audit #15).
    expect(insertedRows.every((r: { idempotency_key: string }) => r.idempotency_key === "pkg_session:session-42")).toBe(true);
    expect(insertedRows.every((r: { status: string }) => r.status === "completed")).toBe(true);
    expect(insertedRows[0]).toMatchObject({ destination_id: "batch-A", source_id: "lot-cap-1", quantity: 10 });
    expect(insertedRows[1]).toMatchObject({ destination_id: "batch-A", source_id: "lot-cap-2", quantity: 6 });
    expect(insertedRows[2]).toMatchObject({ destination_id: null, source_id: "lot-cap-2", quantity: 4 });
  });

  it("sorts the insert batch by (inventory_item_id, lot id) — canonical lock order, not BOM/FIFO pick order (audit PG-2)", async () => {
    // BOM lists item-z BEFORE item-a, and item-a's FIFO pick order is
    // lot-a-9 (expires first) before lot-a-1. The insert batch must instead be
    // sorted (item-a lot-a-1, item-a lot-a-9, item-z lot-z-1): the rows'
    // insert order is guard_allocation_availability's FOR UPDATE
    // lock-acquisition order on inventory_lots, and concurrent packaging
    // writers sharing materials must acquire those locks in one canonical
    // order or they can deadlock.
    const preloaded: PackagingDepletionLineItem[] = [
      { selling_format_id: "fmt-1", actual_quantity: 5, batch_id: "batch-A" },
    ];
    const { supabase, callsByTable } = makeSupabase({
      allocations: [{ data: [], error: null }, { data: null, error: null }],
      selling_format_materials: [
        {
          data: [
            {
              selling_format_id: "fmt-1",
              inventory_item_id: "item-z",
              quantity_per_unit: 1,
              inventory_item: { unit: "oz" },
            },
            {
              selling_format_id: "fmt-1",
              inventory_item_id: "item-a",
              quantity_per_unit: 3,
              inventory_item: { unit: "oz" },
            },
          ],
          error: null,
        },
      ],
      inventory_lots_with_quantities: [
        {
          data: [
            {
              id: "lot-z-1",
              inventory_item_id: "item-z",
              lot_number: "Z1",
              remaining_quantity: 50,
              expiration_date: "2025-06-01",
              received_date: "2025-01-01",
              unit_cost: 0.1,
            },
            {
              id: "lot-a-1",
              inventory_item_id: "item-a",
              lot_number: "A1",
              remaining_quantity: 20,
              expiration_date: "2026-01-01",
              received_date: "2026-01-01",
              unit_cost: 0.5,
            },
            {
              id: "lot-a-9",
              inventory_item_id: "item-a",
              lot_number: "A9",
              remaining_quantity: 10,
              expiration_date: "2025-01-01",
              received_date: "2025-01-01",
              unit_cost: 0.4,
            },
          ],
          error: null,
        },
      ],
    });

    const result = await consumePackagingMaterials(supabase, "session-7", preloaded);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({ allocations_inserted: 3, shortfalls: [] });

    // item-a needs 5*3=15: FIFO picks lot-a-9 (10, expires first) then
    // lot-a-1 (5) — but the BATCH is sorted by (item, lot id).
    const insertedRows = callsByTable.allocations[1].insert.mock.calls[0][0];
    expect(insertedRows.map((r: { source_id: string }) => r.source_id)).toEqual([
      "lot-a-1",
      "lot-a-9",
      "lot-z-1",
    ]);
    // FIFO still decides the QUANTITIES; only the row order is canonical.
    expect(insertedRows).toEqual([
      expect.objectContaining({ source_id: "lot-a-1", quantity: 5 }),
      expect.objectContaining({ source_id: "lot-a-9", quantity: 10 }),
      expect.objectContaining({ source_id: "lot-z-1", quantity: 5 }),
    ]);
  });

  it("reports a shortfall when available lots don't cover the required quantity, and still inserts the covered picks", async () => {
    const preloaded: PackagingDepletionLineItem[] = [
      { selling_format_id: "fmt-1", actual_quantity: 10, batch_id: "batch-A" },
    ];
    const { supabase } = makeSupabase({
      allocations: [{ data: [], error: null }, { data: null, error: null }],
      selling_format_materials: [
        {
          data: [
            {
              selling_format_id: "fmt-1",
              inventory_item_id: "cap-1",
              quantity_per_unit: 1,
              inventory_item: { unit: "oz" },
            },
          ],
          error: null,
        },
      ],
      inventory_lots_with_quantities: [
        {
          data: [
            {
              id: "lot-cap-1",
              inventory_item_id: "cap-1",
              lot_number: "C1",
              remaining_quantity: 4,
              expiration_date: "2025-01-01",
              received_date: "2025-01-01",
              unit_cost: 0.5,
            },
          ],
          error: null,
        },
      ],
    });

    const result = await consumePackagingMaterials(supabase, "session-1", preloaded);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.allocations_inserted).toBe(1);
    expect(result.data.shortfalls).toEqual([{ inventory_item_id: "cap-1", quantity: 6 }]);
  });

  it("returns a parsed error when the final insert fails", async () => {
    const preloaded: PackagingDepletionLineItem[] = [
      { selling_format_id: "fmt-1", actual_quantity: 5, batch_id: "batch-A" },
    ];
    const { supabase } = makeSupabase({
      allocations: [{ data: [], error: null }, { data: null, error: { message: "insert failed" } }],
      selling_format_materials: [
        {
          data: [
            {
              selling_format_id: "fmt-1",
              inventory_item_id: "cap-1",
              quantity_per_unit: 1,
              inventory_item: { unit: "oz" },
            },
          ],
          error: null,
        },
      ],
      inventory_lots_with_quantities: [
        {
          data: [
            {
              id: "lot-cap-1",
              inventory_item_id: "cap-1",
              lot_number: "C1",
              remaining_quantity: 10,
              expiration_date: "2025-01-01",
              received_date: "2025-01-01",
              unit_cost: 0.5,
            },
          ],
          error: null,
        },
      ],
    });

    const result = await consumePackagingMaterials(supabase, "session-1", preloaded);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toEqual({
      code: "UNKNOWN",
      message: "insert failed",
      cause: { message: "insert failed" },
    });
  });

  it("catches a synchronous throw and returns a wrapped UNKNOWN error", async () => {
    const { supabase } = throwingSupabase("allocations check exploded");

    const result = await consumePackagingMaterials(supabase, "session-1");
    expect(result.success).toBe(false);
    if (result.success) return;
    expect((result.error as { message: string }).message).toContain(
      "Failed to deplete packaging materials",
    );
  });

  it("catches an async rejection from the guard query and returns the same wrapped error shape as a synchronous throw", async () => {
    const { supabase } = makeSupabase({
      allocations: [{ rejectWith: new Error("connection reset") }],
    });

    const result = await consumePackagingMaterials(supabase, "session-1");

    expect(result).toEqual({
      success: false,
      error: {
        code: "UNKNOWN",
        message: "Failed to deplete packaging materials: connection reset",
        cause: new Error("connection reset"),
      },
    });
  });
});

// =============================================================================
// recordBatchLoss
// =============================================================================

describe("recordBatchLoss", () => {
  it("inserts a completed batch->loss allocation with quantity mirroring volume_bbl", async () => {
    const { supabase, callsByTable } = makeSupabase({
      allocations: [{ data: null, error: null }],
    });

    const result = await recordBatchLoss(supabase, {
      batchId: "batch-1",
      volumeBbl: 1.5,
      reasonCode: "spillage",
    });

    expect(result).toEqual({ success: true, data: null, invalidate: [] });
    const inserted = callsByTable.allocations[0].insert.mock.calls[0][0];
    expect(inserted).toMatchObject({
      source_type: "batch",
      source_id: "batch-1",
      destination_type: "loss",
      destination_id: null,
      quantity: 1.5, // QUIRK: quantity duplicates volume_bbl for loss rows
      volume_bbl: 1.5,
      status: "completed",
      reason_code: "spillage",
      notes: null, // defaults to null when omitted
    });
    expect(typeof inserted.completed_at).toBe("string");
  });

  it("returns a parsed error when the insert fails", async () => {
    const { supabase } = makeSupabase({
      allocations: [{ data: null, error: { message: "loss insert failed" } }],
    });

    const result = await recordBatchLoss(supabase, {
      batchId: "batch-1",
      volumeBbl: 1,
      reasonCode: "spillage",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toEqual({
      code: "UNKNOWN",
      message: "loss insert failed",
      cause: { message: "loss insert failed" },
    });
  });

  it("catches a synchronous throw and returns a wrapped UNKNOWN error", async () => {
    const { supabase } = throwingSupabase("loss exploded");

    const result = await recordBatchLoss(supabase, {
      batchId: "batch-1",
      volumeBbl: 1,
      reasonCode: "spillage",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect((result.error as { message: string }).message).toContain("Failed to record loss");
  });
});

// =============================================================================
// recordQuickDepletion
// =============================================================================

describe("recordQuickDepletion", () => {
  it("inserts a completed quick-depletion allocation with the given fields", async () => {
    const { supabase, callsByTable } = makeSupabase({
      allocations: [{ data: null, error: null }],
    });

    const result = await recordQuickDepletion(supabase, {
      sourceType: "finished_good",
      sourceId: "fg-1",
      destinationType: "taproom_sale",
      quantity: 2,
      volumeBbl: 0.1,
      reasonCode: "tasting",
      notes: "pour for staff",
    });

    expect(result).toEqual({ success: true, data: null, invalidate: [] });
    const inserted = callsByTable.allocations[0].insert.mock.calls[0][0];
    expect(inserted).toMatchObject({
      source_type: "finished_good",
      source_id: "fg-1",
      destination_type: "taproom_sale",
      destination_id: null,
      quantity: 2,
      volume_bbl: 0.1,
      status: "completed",
      reason_code: "tasting",
      notes: "pour for staff",
    });
  });

  it("defaults optional fields (volumeBbl/reasonCode/notes) to null when omitted", async () => {
    const { supabase, callsByTable } = makeSupabase({
      allocations: [{ data: null, error: null }],
    });

    await recordQuickDepletion(supabase, {
      sourceType: "inventory_lot",
      sourceId: "lot-1",
      destinationType: "sample",
      quantity: 1,
    });

    const inserted = callsByTable.allocations[0].insert.mock.calls[0][0];
    expect(inserted.volume_bbl).toBeNull();
    expect(inserted.reason_code).toBeNull();
    expect(inserted.notes).toBeNull();
  });

  it("returns a parsed error when the insert fails", async () => {
    const { supabase } = makeSupabase({
      allocations: [{ data: null, error: { message: "depletion insert failed" } }],
    });

    const result = await recordQuickDepletion(supabase, {
      sourceType: "inventory_lot",
      sourceId: "lot-1",
      destinationType: "destruction",
      quantity: 1,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toEqual({
      code: "UNKNOWN",
      message: "depletion insert failed",
      cause: { message: "depletion insert failed" },
    });
  });

  it("catches a synchronous throw and returns a wrapped UNKNOWN error", async () => {
    const { supabase } = throwingSupabase("depletion exploded");

    const result = await recordQuickDepletion(supabase, {
      sourceType: "inventory_lot",
      sourceId: "lot-1",
      destinationType: "destruction",
      quantity: 1,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect((result.error as { message: string }).message).toContain("Failed to record depletion");
  });
});

// =============================================================================
// getBatchLossSummary / reconcileBatchLoss
// =============================================================================

/**
 * produced 10 (two brews), blend out 2 / in 0 -> baseline 8; packaged 6
 * (24 units x 992 oz = 0.25 bbl via the volume_oz fallback); attributed 0.5
 * (a transfer-prompt loss; the finished_good row is excluded) -> unattributed 1.5.
 */
const lossTables = (): Record<string, Resp[]> => ({
  brew_log_batches: [{ data: [{ volume_bbl: 6 }, { volume_bbl: 4 }], error: null }],
  batch_blends: [
    { data: [{ volume_bbl: 2 }], error: null }, // out (source_batch_id)
    { data: [], error: null }, // in (blend_batch_id)
  ],
  allocations: [
    {
      data: [
        { volume_bbl: 0.5, idempotency_key: null, destination_type: "loss" },
        { volume_bbl: null, idempotency_key: null, destination_type: "finished_good" },
      ],
      error: null,
    },
    { data: null, error: null }, // insert (writer only)
  ],
  session_line_items: [
    {
      data: [
        {
          actual_quantity: 24,
          selling_format: { unit_count: 1, container: { volume_bbl: null, volume_oz: 992 } },
          session: { status: "completed" },
        },
        // null actuals and missing formats are skipped, not counted
        {
          actual_quantity: null,
          selling_format: { unit_count: 1, container: { volume_bbl: 0.1, volume_oz: null } },
          session: { status: "completed" },
        },
        { actual_quantity: 50, selling_format: null, session: { status: "completed" } },
      ],
      error: null,
    },
  ],
});

describe("getBatchLossSummary", () => {
  it("computes the packaged-vs-produced identity with blends, oz fallback, and attribution", async () => {
    const { supabase } = makeSupabase(lossTables());

    const result = await getBatchLossSummary(supabase, "batch-1");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.producedBbl).toBeCloseTo(10);
    expect(result.data.baselineBbl).toBeCloseTo(8);
    expect(result.data.packagedBbl).toBeCloseTo(6);
    expect(result.data.attributedBbl).toBeCloseTo(0.5);
    expect(result.data.unattributedBbl).toBeCloseTo(1.5);
    expect(result.data.hasOpenSessions).toBe(false);
    expect(result.data.reconciled).toBe(false);
  });

  it("counts revised-session line items toward packagedBbl and excludes cancelled ones (M6)", async () => {
    const tables = lossTables();
    tables.session_line_items = [
      {
        data: [
          // revised: the revise RPC (00184) rewrote actuals to final
          // quantities before flipping the status — counts as packaged.
          {
            actual_quantity: 24,
            selling_format: { unit_count: 1, container: { volume_bbl: null, volume_oz: 992 } },
            session: { status: "revised" },
          },
          // cancelled: the packaging never happened — excluded, and terminal.
          {
            actual_quantity: 100,
            selling_format: { unit_count: 1, container: { volume_bbl: 0.25, volume_oz: null } },
            session: { status: "cancelled" },
          },
        ],
        error: null,
      },
    ];
    const { supabase } = makeSupabase(tables);

    const result = await getBatchLossSummary(supabase, "batch-1");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.packagedBbl).toBeCloseTo(6); // revised line only
    // revised/cancelled are terminal — neither marks the batch as open (H5).
    expect(result.data.hasOpenSessions).toBe(false);
    expect(result.data.unattributedBbl).toBeCloseTo(1.5);
  });

  it("treats only planned/in_progress sessions as open and never counts their actuals", async () => {
    const tables = lossTables();
    tables.session_line_items = [
      {
        data: [
          {
            actual_quantity: 10,
            selling_format: { unit_count: 1, container: { volume_bbl: 0.25, volume_oz: null } },
            session: { status: "planned" },
          },
        ],
        error: null,
      },
    ];
    const { supabase } = makeSupabase(tables);

    const result = await getBatchLossSummary(supabase, "batch-1");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.hasOpenSessions).toBe(true);
    expect(result.data.packagedBbl).toBe(0);
  });

  it("returns a null unattributed remainder when there is no production baseline", async () => {
    const { supabase } = makeSupabase({
      brew_log_batches: [{ data: [], error: null }],
      batch_blends: [
        { data: [], error: null },
        { data: [], error: null },
      ],
      allocations: [{ data: [], error: null }],
      session_line_items: [{ data: [], error: null }],
    });

    const result = await getBatchLossSummary(supabase, "batch-1");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.unattributedBbl).toBeNull();
  });

  it("returns a parsed error when a read fails", async () => {
    const { supabase } = makeSupabase({
      brew_log_batches: [{ data: null, error: { message: "boom" } }],
    });

    const result = await getBatchLossSummary(supabase, "batch-1");

    expect(result.success).toBe(false);
  });
});

describe("reconcileBatchLoss", () => {
  it("auto-records the unattributed remainder with the reconciliation reason code", async () => {
    const { supabase, callsByTable } = makeSupabase(lossTables());

    const result = await reconcileBatchLoss(supabase, "batch-1");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toBeCloseTo(1.5);
    const inserted = callsByTable.allocations[1].insert.mock.calls[0][0];
    expect(inserted).toMatchObject({
      source_type: "batch",
      source_id: "batch-1",
      destination_type: "loss",
      status: "completed",
      reason_code: "reconciliation",
    });
    expect(inserted.volume_bbl).toBeCloseTo(1.5);
    expect(inserted.notes).toContain("Completion loss reconciliation");
  });

  it("is idempotent: skips when a reconciliation allocation already exists", async () => {
    const tables = lossTables();
    tables.allocations = [
      {
        data: [
          {
            volume_bbl: 1.5,
            // Guard keys on the stable idempotency_key system column, not the
            // user-editable reason_code/notes (audit #15).
            idempotency_key: "batch_reconcile:batch-1",
            destination_type: "loss",
          },
        ],
        error: null,
      },
    ];
    const { supabase, callsByTable } = makeSupabase(tables);

    const result = await reconcileBatchLoss(supabase, "batch-1");

    expect(result).toEqual({ success: true, data: 0, invalidate: [] });
    expect(callsByTable.allocations).toHaveLength(1); // guard select only, no insert
  });

  it("does NOT treat a user-picked reason_code='reconciliation' as the guard — only the idempotency_key counts (audit #15)", async () => {
    // A manual batch-loss row that happens to carry reason_code='reconciliation'
    // (a selectable "Completion Reconciliation" option) but no idempotency_key
    // must not spoof the guard, or legitimate auto-reconciliation is suppressed.
    const tables = lossTables();
    tables.allocations = [
      {
        data: [
          { volume_bbl: 0.5, idempotency_key: null, destination_type: "loss" },
          { volume_bbl: null, idempotency_key: null, destination_type: "finished_good" },
        ],
        error: null,
      },
      { data: null, error: null }, // insert (writer only) — proves it still fires
    ];
    const { supabase, callsByTable } = makeSupabase(tables);

    const result = await reconcileBatchLoss(supabase, "batch-1");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toBeCloseTo(1.5); // reconciliation still recorded
    const inserted = callsByTable.allocations[1].insert.mock.calls[0][0];
    expect(inserted.idempotency_key).toBe("batch_reconcile:batch-1");
    expect(inserted.reason_code).toBe("reconciliation");
  });

  it("skips while any packaging session for the batch is still open", async () => {
    const tables = lossTables();
    tables.session_line_items = [
      {
        data: [
          {
            actual_quantity: null,
            selling_format: { unit_count: 1, container: { volume_bbl: 0.1, volume_oz: null } },
            session: { status: "in_progress" },
          },
        ],
        error: null,
      },
    ];
    const { supabase, callsByTable } = makeSupabase(tables);

    const result = await reconcileBatchLoss(supabase, "batch-1");

    expect(result).toEqual({ success: true, data: 0, invalidate: [] });
    expect(callsByTable.allocations).toHaveLength(1);
  });

  it("reconciles a batch whose sessions were revised — revised is terminal, not open (H5)", async () => {
    const tables = lossTables();
    tables.session_line_items = [
      {
        data: [
          {
            actual_quantity: 24,
            selling_format: { unit_count: 1, container: { volume_bbl: null, volume_oz: 992 } },
            session: { status: "revised" },
          },
        ],
        error: null,
      },
    ];
    const { supabase, callsByTable } = makeSupabase(tables);

    const result = await reconcileBatchLoss(supabase, "batch-1");

    expect(result.success).toBe(true);
    if (!result.success) return;
    // Revised actuals count as packaged (6 bbl) → 1.5 bbl remainder recorded.
    expect(result.data).toBeCloseTo(1.5);
    const inserted = callsByTable.allocations[1].insert.mock.calls[0][0];
    expect(inserted).toMatchObject({ reason_code: "reconciliation", status: "completed" });
    expect(inserted.volume_bbl).toBeCloseTo(1.5);
  });

  it("neither blocks on nor counts a cancelled session's line items (H5/M6)", async () => {
    const tables = lossTables();
    tables.session_line_items = [
      {
        data: [
          {
            actual_quantity: 24,
            selling_format: { unit_count: 1, container: { volume_bbl: null, volume_oz: 992 } },
            session: { status: "completed" },
          },
          // If this cancelled line counted, packaged would be 8 bbl and the
          // remainder −0.5 (below threshold) — no reconciliation would fire.
          {
            actual_quantity: 8,
            selling_format: { unit_count: 1, container: { volume_bbl: 0.25, volume_oz: null } },
            session: { status: "cancelled" },
          },
        ],
        error: null,
      },
    ];
    const { supabase, callsByTable } = makeSupabase(tables);

    const result = await reconcileBatchLoss(supabase, "batch-1");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toBeCloseTo(1.5);
    const inserted = callsByTable.allocations[1].insert.mock.calls[0][0];
    expect(inserted.volume_bbl).toBeCloseTo(1.5);
  });

  it("skips when there is no production baseline (no brew logs, no blend inflow)", async () => {
    const { supabase, callsByTable } = makeSupabase({
      brew_log_batches: [{ data: [], error: null }],
      batch_blends: [
        { data: [], error: null },
        { data: [], error: null },
      ],
      allocations: [{ data: [], error: null }],
      session_line_items: [{ data: [], error: null }],
    });

    const result = await reconcileBatchLoss(supabase, "batch-1");

    expect(result).toEqual({ success: true, data: 0, invalidate: [] });
    expect(callsByTable.allocations).toHaveLength(1);
  });

  it("does not record remainders below the reconciliation threshold", async () => {
    const tables = lossTables();
    // packaged 7.97 of an 8 bbl baseline (with 0.5 attributed the remainder
    // is negative) -> use no attribution and packaged 7.97: remainder 0.03 < 0.05.
    tables.allocations = [{ data: [], error: null }];
    tables.session_line_items = [
      {
        data: [
          {
            actual_quantity: 79.7,
            selling_format: { unit_count: 1, container: { volume_bbl: 0.1, volume_oz: null } },
            session: { status: "completed" },
          },
        ],
        error: null,
      },
    ];
    const { supabase, callsByTable } = makeSupabase(tables);

    const result = await reconcileBatchLoss(supabase, "batch-1");

    expect(result).toEqual({ success: true, data: 0, invalidate: [] });
    expect(callsByTable.allocations).toHaveLength(1);
  });

  it("propagates read errors", async () => {
    const { supabase } = makeSupabase({
      brew_log_batches: [{ data: null, error: { message: "boom" } }],
    });

    const result = await reconcileBatchLoss(supabase, "batch-1");

    expect(result.success).toBe(false);
  });
});
