/**
 * Characterization tests for the pure report summary/aggregation calculations
 * in src/lib/reports/summaries.ts. These functions were extracted verbatim
 * from the report pages (cogs, batch-cost, production-summary,
 * inventory-valuation, projections); the expectations below pin the behavior
 * the pages shipped with.
 */

import { describe, it, expect } from "vitest";
import {
  computeCogsBatchSummary,
  computeCogsSkuSummary,
  computeCogsPeriodSummary,
  computeBatchCostSummary,
  aggregateProduction,
  computeAvgDaysInTank,
  aggregateRawMaterials,
  aggregateFinishedGoodsValuation,
  buildBatchCostMap,
  groupIngredientsBySource,
} from "@/lib/reports/summaries";
import type { CogsSkuRow, CogsPeriodRow } from "@/lib/reports/cogs";

// =============================================================================
// COGS — By Batch summary
// =============================================================================

describe("computeCogsBatchSummary", () => {
  it("returns zeroed summary for empty/undefined input", () => {
    const empty = {
      avgCostPerBbl: 0,
      totalMaterialCost: 0,
      batchCount: 0,
      totalUnitsPackaged: 0,
    };
    expect(computeCogsBatchSummary(undefined)).toEqual(empty);
    expect(computeCogsBatchSummary([])).toEqual(empty);
  });

  it("computes totals and averages, ignoring zero/null volumes in the BBL average", () => {
    const result = computeCogsBatchSummary([
      { volume_bbl: 10, total_ingredient_cost: 500, units_packaged: 100 },
      { volume_bbl: null, total_ingredient_cost: 200, units_packaged: 40 },
      { volume_bbl: 0, total_ingredient_cost: 100, units_packaged: 0 },
    ]);
    // Cost of ALL batches divided by volume of batches WITH volume (existing behavior)
    expect(result.avgCostPerBbl).toBeCloseTo(800 / 10);
    expect(result.totalMaterialCost).toBe(800);
    expect(result.batchCount).toBe(3);
    expect(result.totalUnitsPackaged).toBe(140);
  });
});

// =============================================================================
// COGS — By SKU summary
// =============================================================================

function skuRow(partial: Partial<CogsSkuRow>): CogsSkuRow {
  return {
    sku_name: "sku",
    brand_name: "brand",
    format_name: "format",
    container_name: "",
    batch_count: 1,
    total_units: 0,
    total_cost: 0,
    avg_cost_per_unit: null,
    avg_cost_per_bbl: null,
    batches: [],
    ...partial,
  };
}

describe("computeCogsSkuSummary", () => {
  it("returns null extremes and zero average for empty input", () => {
    expect(computeCogsSkuSummary(undefined)).toEqual({
      highestCostSku: null,
      lowestCostSku: null,
      weightedAvgCostPerUnit: 0,
    });
  });

  it("picks highest/lowest cost SKUs among those with units, weighted average", () => {
    const high = skuRow({
      sku_name: "high",
      total_units: 10,
      total_cost: 100,
      avg_cost_per_unit: 10,
    });
    const low = skuRow({
      sku_name: "low",
      total_units: 30,
      total_cost: 60,
      avg_cost_per_unit: 2,
    });
    const noUnits = skuRow({
      sku_name: "no-units",
      total_units: 0,
      total_cost: 999,
      avg_cost_per_unit: 999,
    });
    // A third qualifying SKU with a middle cost: with only two rows, "highest"
    // and "lowest" are indistinguishable from an off-by-one or an inverted
    // comparator, so the middle row is what actually pins the sort.
    const middle = skuRow({
      sku_name: "middle",
      total_units: 10,
      total_cost: 50,
      avg_cost_per_unit: 5,
    });
    const result = computeCogsSkuSummary([low, noUnits, middle, high]);
    expect(result.highestCostSku?.sku_name).toBe("high");
    expect(result.lowestCostSku?.sku_name).toBe("low");
    // (100 + 60 + 50) / (10 + 30 + 10) = 4.2 — zero-unit SKUs excluded
    expect(result.weightedAvgCostPerUnit).toBeCloseTo(4.2);
  });

  it("treats a null avg_cost_per_unit as zero when ranking", () => {
    const priced = skuRow({
      sku_name: "priced",
      total_units: 10,
      total_cost: 100,
      avg_cost_per_unit: 10,
    });
    const unpriced = skuRow({
      sku_name: "unpriced",
      total_units: 5,
      total_cost: 20,
      avg_cost_per_unit: null,
    });
    const result = computeCogsSkuSummary([unpriced, priced]);
    // null coerces to 0, so the unpriced SKU sorts to the bottom rather than
    // producing NaN comparisons and an arbitrary order.
    expect(result.highestCostSku?.sku_name).toBe("priced");
    expect(result.lowestCostSku?.sku_name).toBe("unpriced");
  });
});

// =============================================================================
// COGS — By Period summary
// =============================================================================

function periodRow(partial: Partial<CogsPeriodRow>): CogsPeriodRow {
  return {
    period: "2026-01",
    _sortKey: "2026-01-01",
    total_cogs: 0,
    malt_cost: 0,
    hop_cost: 0,
    yeast_cost: 0,
    adjunct_cost: 0,
    other_cost: 0,
    batch_count: 0,
    ...partial,
  };
}

describe("computeCogsPeriodSummary", () => {
  it("returns zeroed summary with null periodChange for empty input", () => {
    const result = computeCogsPeriodSummary([]);
    expect(result.totalCogs).toBe(0);
    expect(result.periodChange).toBeNull();
    expect(result.avgCogsPerBatch).toBe(0);
  });

  it("sums category totals and computes period-over-period change from the last two rows", () => {
    const result = computeCogsPeriodSummary([
      periodRow({
        period: "2026-01",
        total_cogs: 100,
        malt_cost: 50,
        hop_cost: 25,
        yeast_cost: 10,
        adjunct_cost: 10,
        other_cost: 5,
        batch_count: 2,
      }),
      periodRow({ period: "2026-02", total_cogs: 200, batch_count: 2 }),
      periodRow({ period: "2026-03", total_cogs: 150, batch_count: 1 }),
    ]);
    expect(result.totalCogs).toBe(450);
    expect(result.totalMalt).toBe(50);
    expect(result.totalHop).toBe(25);
    expect(result.totalYeast).toBe(10);
    expect(result.totalAdjunct).toBe(10);
    expect(result.totalOther).toBe(5);
    expect(result.totalBatches).toBe(5);
    // (150 - 200) / 200 * 100 = -25%
    expect(result.periodChange).toBeCloseTo(-25);
    expect(result.avgCogsPerBatch).toBeCloseTo(450 / 5);
  });

  it("keeps periodChange null when previous period had zero COGS", () => {
    const result = computeCogsPeriodSummary([
      periodRow({ period: "2026-01", total_cogs: 0 }),
      periodRow({ period: "2026-02", total_cogs: 100 }),
    ]);
    expect(result.periodChange).toBeNull();
  });
});

// =============================================================================
// Batch cost analysis summary
// =============================================================================

describe("computeBatchCostSummary", () => {
  it("returns zeroed summary for empty input", () => {
    expect(computeBatchCostSummary([])).toEqual({
      avgCostPerBatch: 0,
      avgCostPerBbl: 0,
      totalProductionCost: 0,
      batchCount: 0,
    });
  });

  it("averages over all batches but only volumed batches for per-BBL", () => {
    const result = computeBatchCostSummary([
      { volume_bbl: 10, ingredient_cost: 300 },
      { volume_bbl: null, ingredient_cost: 100 },
      { volume_bbl: 5, ingredient_cost: 200 },
    ]);
    expect(result.totalProductionCost).toBe(600);
    expect(result.avgCostPerBatch).toBeCloseTo(200);
    expect(result.avgCostPerBbl).toBeCloseTo(600 / 15);
    expect(result.batchCount).toBe(3);
  });
});

// =============================================================================
// Production summary aggregation
// =============================================================================

describe("aggregateProduction", () => {
  const batches = [
    { volume_bbl: 10, brand: "A" },
    { volume_bbl: 20, brand: "B" },
    { volume_bbl: 30, brand: "A" },
    { volume_bbl: null, brand: "B" },
  ];

  it("groups by key, sums volume, counts batches, sorts by totalBbl desc", () => {
    const rows = aggregateProduction(
      batches,
      (b) => b.brand,
      (b) => `Brand ${b.brand}`
    );
    expect(rows).toEqual([
      {
        key: "A",
        label: "Brand A",
        batchCount: 2,
        totalBbl: 40,
        avgBblPerBatch: 20,
      },
      {
        key: "B",
        label: "Brand B",
        batchCount: 2,
        totalBbl: 20,
        avgBblPerBatch: 10,
      },
    ]);
  });

  it("labels each group from the first row seen in that group", () => {
    // Rows in one group can disagree on the label (e.g. a renamed brand). The
    // first row encountered wins; a last-write-wins implementation would
    // report "second" here.
    const rows = aggregateProduction(
      [
        { volume_bbl: 1, brand: "A", label: "first" },
        { volume_bbl: 2, brand: "A", label: "second" },
      ],
      (b) => b.brand,
      (b) => b.label
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("first");
  });

  it("returns empty for no batches", () => {
    expect(aggregateProduction([], () => "x", () => "x")).toEqual([]);
  });
});

describe("computeAvgDaysInTank", () => {
  const daysSince = (start: string) =>
    ({ "2026-01-01": 30, "2026-02-01": 10, future: -5 })[start] ?? 0;

  it("returns null for empty input or when no batch qualifies", () => {
    expect(computeAvgDaysInTank(undefined, daysSince)).toBeNull();
    expect(computeAvgDaysInTank([], daysSince)).toBeNull();
    expect(
      computeAvgDaysInTank(
        [{ planned_start_date: null }, { planned_start_date: "future" }],
        daysSince
      )
    ).toBeNull();
  });

  it("averages non-negative day counts, skipping null and future starts", () => {
    expect(
      computeAvgDaysInTank(
        [
          { planned_start_date: "2026-01-01" },
          { planned_start_date: "2026-02-01" },
          { planned_start_date: null },
          { planned_start_date: "future" },
        ],
        daysSince
      )
    ).toBe(20);
  });
});

// =============================================================================
// Inventory valuation aggregation
// =============================================================================

describe("aggregateRawMaterials", () => {
  it("returns empty for undefined", () => {
    expect(aggregateRawMaterials(undefined)).toEqual([]);
  });

  it("groups lots by item with weighted average cost, sorted by category then name", () => {
    const rows = aggregateRawMaterials([
      {
        inventory_item_id: "malt-1",
        remaining_quantity: 100,
        unit: "lbs",
        unit_cost: 1,
        inventory_items: { name: "Pilsner", category: "malt" },
      },
      {
        inventory_item_id: "malt-1",
        remaining_quantity: 50,
        unit: "lbs",
        unit_cost: 2,
        inventory_items: { name: "Pilsner", category: "malt" },
      },
      {
        inventory_item_id: "hop-1",
        remaining_quantity: 10,
        unit: "oz",
        unit_cost: 3,
        inventory_items: { name: "Citra", category: "hop" },
      },
    ]);
    expect(rows).toEqual([
      {
        itemName: "Citra",
        category: "hop",
        totalQuantity: 10,
        unit: "oz",
        avgUnitCost: 3,
        totalValue: 30,
      },
      {
        itemName: "Pilsner",
        category: "malt",
        totalQuantity: 150,
        unit: "lbs",
        // (100*1 + 50*2) / 150
        avgUnitCost: 200 / 150,
        totalValue: 200,
      },
    ]);
  });

  it("defaults missing item info to Unknown Item / other", () => {
    const rows = aggregateRawMaterials([
      {
        inventory_item_id: null,
        remaining_quantity: 5,
        unit: null,
        unit_cost: null,
        inventory_items: null,
      },
    ]);
    expect(rows[0]).toMatchObject({
      itemName: "Unknown Item",
      category: "other",
      totalQuantity: 5,
      unit: "",
      avgUnitCost: 0,
      totalValue: 0,
    });
  });
});

describe("aggregateFinishedGoodsValuation", () => {
  it("groups by brand + package, values units at batch cost per unit", () => {
    const batchCosts = new Map([
      ["b1", { totalCost: 100, totalUnits: 50 }], // $2/unit
      ["b2", { totalCost: 0, totalUnits: 0 }],
    ]);
    const rows = aggregateFinishedGoodsValuation(
      [
        {
          batch_id: "b1",
          brand_name: "IPA",
          selling_format_name: "Keg",
          available_quantity: 10,
        },
        {
          batch_id: "b1",
          brand_name: "IPA",
          selling_format_name: "Keg",
          available_quantity: 5,
        },
        {
          batch_id: "b2",
          brand_name: null,
          selling_format_name: null,
          available_quantity: 3,
        },
      ],
      batchCosts
    );
    expect(rows).toEqual([
      {
        brandName: "IPA",
        packageType: "Keg",
        quantity: 15,
        unitCostEstimate: 2,
        totalValue: 30,
      },
      {
        brandName: "Unknown",
        packageType: "Unknown",
        quantity: 3,
        unitCostEstimate: 0,
        totalValue: 0,
      },
    ]);
  });

  it("values at zero when batch costs are missing", () => {
    const rows = aggregateFinishedGoodsValuation(
      [
        {
          batch_id: "b1",
          brand_name: "IPA",
          selling_format_name: "Can",
          available_quantity: 4,
        },
      ],
      undefined
    );
    expect(rows[0].totalValue).toBe(0);
  });
});

describe("buildBatchCostMap", () => {
  it("sums allocation line costs and FG units per batch", () => {
    const map = buildBatchCostMap(
      ["b1", "b2"],
      [
        { destination_id: "b1", quantity: 10, unit_cost: 2 },
        { destination_id: "b1", quantity: 5, unit_cost: 4 },
        { destination_id: null, quantity: 99, unit_cost: 99 },
      ],
      [
        { batch_id: "b1", quantity: 20 },
        { batch_id: "b1", quantity: 10 },
        { batch_id: null, quantity: 99 },
      ]
    );
    expect(map.get("b1")).toEqual({ totalCost: 40, totalUnits: 30 });
    expect(map.get("b2")).toEqual({ totalCost: 0, totalUnits: 0 });
  });
});

// =============================================================================
// Projections grouping
// =============================================================================

describe("groupIngredientsBySource", () => {
  const batches = [
    { id: "b1", batch_code: "B-001" },
    { id: "b2", batch_code: "B-002" },
  ];
  const ingredients = [
    {
      name: "Pilsner",
      category: "malt",
      unit: "lbs",
      sources: [
        { type: "batch" as const, id: "b1", label: "B-001", qty: 100 },
        { type: "order" as const, id: "o1", label: "SO-1", qty: 100 },
      ],
    },
    {
      name: "Citra",
      category: "hop",
      unit: "oz",
      sources: [{ type: "batch" as const, id: "b1", label: "B-001", qty: 8 }],
    },
  ];

  it("returns empty for undefined data", () => {
    expect(groupIngredientsBySource(undefined, "batch", batches)).toEqual([]);
  });

  it("pairs entities with their matching source rows and drops empty entities", () => {
    const result = groupIngredientsBySource(ingredients, "batch", batches);
    expect(result).toHaveLength(1);
    expect(result[0].entity.id).toBe("b1");
    expect(result[0].ingredients).toEqual([
      { name: "Pilsner", category: "malt", qty: 100, unit: "lbs" },
      { name: "Citra", category: "hop", qty: 8, unit: "oz" },
    ]);
  });

  it("ignores sources whose entity is not in the provided list", () => {
    expect(
      groupIngredientsBySource(ingredients, "order", [{ id: "o2" }])
    ).toEqual([]);
  });
});
