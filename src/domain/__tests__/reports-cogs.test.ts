/**
 * Unit tests for the pure COGS report calculations (src/domain/reports/cogs.ts):
 * cost/unit aggregation helpers, proportional SKU cost allocation, and
 * period bucketing with ingredient-category breakdown.
 */

import { describe, it, expect } from "vitest";
import {
  aggregateCostByKey,
  aggregateUnitsByBatch,
  buildSkuCostRows,
  buildPeriodRows,
  type CogsAllocationRow,
  type SkuFinishedGoodRow,
} from "@/domain/reports/cogs";

// =============================================================================
// Fixtures
// =============================================================================

function alloc(
  destination_id: string | null,
  quantity: number,
  unit_cost: number | null,
  source_id: string | null = null
): CogsAllocationRow {
  return { destination_id, quantity, unit_cost, source_id, source_type: source_id ? "inventory_lot" : null };
}

function fg(
  batch_id: string | null,
  quantity: number | null,
  brand: string | null,
  formatName: string | null,
  container: string | null = null
): SkuFinishedGoodRow {
  return {
    batch_id,
    quantity,
    brands: brand ? { name: brand } : null,
    selling_formats: formatName
      ? { name: formatName, containers: container ? { name: container } : null }
      : null,
  };
}

// =============================================================================
// aggregateCostByKey
// =============================================================================

describe("aggregateCostByKey", () => {
  it("sums quantity * unit_cost per key", () => {
    const map = aggregateCostByKey(
      [alloc("b1", 10, 2), alloc("b1", 5, 4), alloc("b2", 1, 100)],
      (a) => a.destination_id
    );
    expect(map.get("b1")).toBe(40); // 10*2 + 5*4
    expect(map.get("b2")).toBe(100);
  });

  it("treats null unit_cost as zero and skips null keys", () => {
    const map = aggregateCostByKey(
      [alloc("b1", 10, null), alloc(null, 5, 4)],
      (a) => a.destination_id
    );
    expect(map.get("b1")).toBe(0);
    expect(map.size).toBe(1);
  });

  it("returns an empty map for empty input", () => {
    expect(
      aggregateCostByKey([] as CogsAllocationRow[], (a) => a.destination_id).size
    ).toBe(0);
  });
});

// =============================================================================
// aggregateUnitsByBatch
// =============================================================================

describe("aggregateUnitsByBatch", () => {
  it("sums quantity per batch and skips null batch_ids", () => {
    const map = aggregateUnitsByBatch([
      { batch_id: "b1", quantity: 100 },
      { batch_id: "b1", quantity: 50 },
      { batch_id: "b2", quantity: null },
      { batch_id: null, quantity: 10 },
    ]);
    expect(map.get("b1")).toBe(150);
    expect(map.get("b2")).toBe(0); // null quantity counts as 0
    expect(map.size).toBe(2);
  });

  it("returns an empty map for empty input", () => {
    expect(aggregateUnitsByBatch([]).size).toBe(0);
  });
});

// =============================================================================
// buildSkuCostRows — proportional allocation
// =============================================================================

describe("buildSkuCostRows", () => {
  const batchInfo = [
    { id: "b1", batch_code: "B-001" },
    { id: "b2", batch_code: "B-002" },
  ];

  it("returns [] for empty input", () => {
    expect(buildSkuCostRows([], [], [], new Map())).toEqual([]);
  });

  it("allocates a batch's cost proportionally to units per SKU", () => {
    // Batch b1 cost: 100. Units: SKU A = 60, SKU B = 40.
    const fgRows = [fg("b1", 60, "Hazy", "6-pack"), fg("b1", 40, "Hazy", "Keg")];
    const rows = buildSkuCostRows(
      fgRows,
      [alloc("b1", 10, 10)],
      batchInfo,
      aggregateUnitsByBatch(fgRows)
    );

    const a = rows.find((r) => r.format_name === "6-pack")!;
    const b = rows.find((r) => r.format_name === "Keg")!;
    expect(a.total_cost).toBeCloseTo(60);
    expect(b.total_cost).toBeCloseTo(40);
  });

  it("proportional allocation sums back to total batch cost across SKUs", () => {
    const allocations = [
      alloc("b1", 7, 13.37),
      alloc("b1", 3, 2.5),
      alloc("b2", 11, 9.99),
    ];
    const fgRows = [
      fg("b1", 17, "Hazy", "6-pack"),
      fg("b1", 23, "Hazy", "Keg"),
      fg("b1", 5, "Other", "Can"),
      fg("b2", 9, "Hazy", "6-pack"),
    ];
    const rows = buildSkuCostRows(
      fgRows,
      allocations,
      batchInfo,
      aggregateUnitsByBatch(fgRows)
    );

    const totalAllocated = rows.reduce((sum, r) => sum + r.total_cost, 0);
    const totalBatchCost = allocations.reduce(
      (sum, a) => sum + a.quantity * (a.unit_cost ?? 0),
      0
    );
    expect(totalAllocated).toBeCloseTo(totalBatchCost, 8);
  });

  it("groups by brand + format, tracks batch breakdown, and sorts by cost desc", () => {
    const fgRows = [
      fg("b1", 50, "Hazy", "6-pack", "Can"),
      fg("b2", 50, "Hazy", "6-pack"),
      fg("b2", 50, "Pils", "Keg"),
    ];
    const rows = buildSkuCostRows(
      fgRows,
      [alloc("b1", 1, 100), alloc("b2", 1, 200)],
      batchInfo,
      aggregateUnitsByBatch(fgRows)
    );

    expect(rows).toHaveLength(2);
    // Hazy 6-pack: all of b1 (100) + half of b2 (100) = 200; Pils Keg: 100
    expect(rows[0].sku_name).toBe("Hazy - 6-pack");
    expect(rows[0].total_cost).toBeCloseTo(200);
    expect(rows[0].batch_count).toBe(2);
    expect(rows[0].container_name).toBe("Can");
    expect(rows[0].batches).toEqual([
      { id: "b1", batch_code: "B-001", cost: 100, units: 50 },
      { id: "b2", batch_code: "B-002", cost: 100, units: 50 },
    ]);
    expect(rows[1].total_cost).toBeCloseTo(100);
  });

  it("merges repeated finished-goods rows for the same batch + SKU", () => {
    const fgRows = [fg("b1", 30, "Hazy", "6-pack"), fg("b1", 70, "Hazy", "6-pack")];
    const rows = buildSkuCostRows(
      fgRows,
      [alloc("b1", 1, 50)],
      batchInfo,
      aggregateUnitsByBatch(fgRows)
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].total_units).toBe(100);
    expect(rows[0].total_cost).toBeCloseTo(50);
    expect(rows[0].batches).toHaveLength(1);
    expect(rows[0].batches[0].units).toBe(100);
    expect(rows[0].batches[0].cost).toBeCloseTo(50);
  });

  it("assigns zero cost when a batch has zero packaged units", () => {
    const fgRows = [fg("b1", 0, "Hazy", "6-pack")];
    const rows = buildSkuCostRows(
      fgRows,
      [alloc("b1", 1, 100)],
      batchInfo,
      aggregateUnitsByBatch(fgRows)
    );
    expect(rows[0].total_cost).toBe(0);
    expect(rows[0].avg_cost_per_unit).toBeNull();
  });

  it("skips rows without a batch_id and labels missing joins as Unknown", () => {
    const fgRows = [fg(null, 10, "Hazy", "6-pack"), fg("b1", 10, null, null)];
    const rows = buildSkuCostRows(
      fgRows,
      [alloc("b1", 1, 30)],
      [], // no batch info -> "??" batch_code
      aggregateUnitsByBatch(fgRows)
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].sku_name).toBe("Unknown - Unknown");
    expect(rows[0].batches[0].batch_code).toBe("??");
    expect(rows[0].total_cost).toBeCloseTo(30);
  });

  it("uses a caller-supplied totalUnitsByBatch instead of fgRows when fgRows is a windowed subset, so a report window that only sees part of a batch's packaging doesn't inflate cost-per-unit", () => {
    // Batch b1 costs 1000 total and packaged 1000 units overall, but this
    // report window's fgRows only contains 400 of those units (the rest
    // packaged outside [fromDate, toDate]). The batch's full cost (1000)
    // must be divided by the batch's full unit count (1000), not the 400
    // visible in this window, or the windowed cost-per-unit is inflated by
    // totalUnits/unitsInWindow and double-counts across adjacent windows.
    const rows = buildSkuCostRows(
      [fg("b1", 400, "Hazy", "6-pack")],
      [alloc("b1", 1, 1000)],
      batchInfo,
      new Map([["b1", 1000]])
    );
    expect(rows[0].total_cost).toBeCloseTo(400); // 1000 * 400/1000, not 1000 * 400/400
    expect(rows[0].avg_cost_per_unit).toBeCloseTo(1); // $1/unit, not $2.50/unit
  });

  it("computes avg_cost_per_unit from totals", () => {
    const fgRows = [fg("b1", 25, "Hazy", "6-pack")];
    const rows = buildSkuCostRows(
      fgRows,
      [alloc("b1", 1, 100)],
      batchInfo,
      aggregateUnitsByBatch(fgRows)
    );
    expect(rows[0].avg_cost_per_unit).toBeCloseTo(4); // 100 / 25
    expect(rows[0].avg_cost_per_bbl).toBeNull();
  });
});

// =============================================================================
// buildPeriodRows — period bucketing + category breakdown
// =============================================================================

describe("buildPeriodRows", () => {
  // Date-only strings: parseISO treats them as local midnight, which keeps the
  // bucket assertions stable regardless of the test runner's timezone.
  // (Production buckets timestamptz values in local time — same code path.)
  const batches = [
    { id: "b-jan", created_at: "2026-01-31" },
    { id: "b-feb", created_at: "2026-02-01" },
    { id: "b-q2", created_at: "2026-04-01" },
  ];

  it("returns [] for empty input", () => {
    expect(buildPeriodRows([], [], new Map(), "monthly")).toEqual([]);
    expect(buildPeriodRows([alloc("b1", 1, 1)], [], new Map(), "monthly")).toEqual([]);
  });

  it("buckets by month using the batch's created_at, sorted chronologically", () => {
    const rows = buildPeriodRows(
      [alloc("b-feb", 1, 20), alloc("b-jan", 1, 10)],
      batches,
      new Map(),
      "monthly"
    );
    expect(rows.map((r) => r.period)).toEqual(["Jan 2026", "Feb 2026"]);
    expect(rows[0].total_cogs).toBe(10);
    expect(rows[1].total_cogs).toBe(20);
  });

  it("respects month boundaries (Jan 31 vs Feb 1 land in different buckets)", () => {
    const rows = buildPeriodRows(
      [alloc("b-jan", 1, 1), alloc("b-feb", 1, 1)],
      batches,
      new Map(),
      "monthly"
    );
    expect(rows).toHaveLength(2);
  });

  it("buckets by quarter when granularity is quarterly", () => {
    const rows = buildPeriodRows(
      [alloc("b-jan", 1, 10), alloc("b-feb", 1, 20), alloc("b-q2", 1, 30)],
      batches,
      new Map(),
      "quarterly"
    );
    expect(rows.map((r) => r.period)).toEqual(["Q1 2026", "Q2 2026"]);
    expect(rows[0].total_cogs).toBe(30); // Jan + Feb
    expect(rows[0].batch_count).toBe(2);
    expect(rows[1].total_cogs).toBe(30);
  });

  it("splits costs into categories and the categories sum to total_cogs", () => {
    const categoryByLotId = new Map([
      ["lot-grain", "grain"],
      ["lot-hops", "hops"],
      ["lot-yeast", "yeast"],
      ["lot-adjunct", "adjunct"],
      ["lot-packaging", "packaging"],
    ]);
    const rows = buildPeriodRows(
      [
        alloc("b-jan", 1, 100, "lot-grain"),
        alloc("b-jan", 1, 50, "lot-hops"),
        alloc("b-jan", 1, 25, "lot-yeast"),
        alloc("b-jan", 1, 10, "lot-adjunct"),
        alloc("b-jan", 1, 5, "lot-packaging"), // unmapped category -> other
        alloc("b-jan", 1, 2, "lot-unknown"), // no category entry -> other
        alloc("b-jan", 1, 1, null), // no source -> other
      ],
      batches,
      categoryByLotId,
      "monthly"
    );

    const row = rows[0];
    expect(row.malt_cost).toBe(100);
    expect(row.hop_cost).toBe(50);
    expect(row.yeast_cost).toBe(25);
    expect(row.adjunct_cost).toBe(10);
    expect(row.other_cost).toBe(8); // 5 + 2 + 1
    expect(
      row.malt_cost + row.hop_cost + row.yeast_cost + row.adjunct_cost + row.other_cost
    ).toBeCloseTo(row.total_cogs);
    expect(row.total_cogs).toBe(193);
  });

  it("counts unique batches per period and skips allocations for unknown batches", () => {
    const rows = buildPeriodRows(
      [
        alloc("b-jan", 1, 10),
        alloc("b-jan", 1, 10),
        alloc("b-missing", 1, 999),
        alloc(null, 1, 999),
      ],
      batches,
      new Map(),
      "monthly"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].batch_count).toBe(1);
    expect(rows[0].total_cogs).toBe(20);
  });
});
