/**
 * Tests for src/domain/consumption-planning.ts — pure logic behind
 * brew-day ingredient consumption, packaging material depletion,
 * and implied-loss capture (audit Batch 9).
 */

import { describe, it, expect } from "vitest";
import {
  suggestFifoAllocations,
  compareFifoLots,
  recipeScaleFactor,
  convertIngredientQuantity,
  computeBomConsumption,
  computeTransferLoss,
  computePackagingLoss,
  type FifoLot,
} from "@/domain/consumption-planning";

function lot(overrides: Partial<FifoLot> & { lot_id: string }): FifoLot {
  return {
    lot_number: overrides.lot_id,
    remaining_quantity: 100,
    expiration_date: null,
    received_date: null,
    unit_cost: null,
    ...overrides,
  };
}

describe("suggestFifoAllocations", () => {
  it("returns no picks for zero or negative requirements", () => {
    expect(suggestFifoAllocations(0, [lot({ lot_id: "a" })]).picks).toEqual([]);
    expect(suggestFifoAllocations(-5, [lot({ lot_id: "a" })]).picks).toEqual([]);
  });

  it("fills from a single lot when sufficient", () => {
    const result = suggestFifoAllocations(40, [
      lot({ lot_id: "a", remaining_quantity: 100 }),
    ]);
    expect(result.picks).toEqual([
      { lot_id: "a", lot_number: "a", quantity: 40, unit_cost: null },
    ]);
    expect(result.shortfall).toBe(0);
  });

  it("splits across lots in soonest-expiry order", () => {
    const result = suggestFifoAllocations(150, [
      lot({ lot_id: "later", remaining_quantity: 100, expiration_date: "2026-12-01" }),
      lot({ lot_id: "sooner", remaining_quantity: 100, expiration_date: "2026-07-01" }),
    ]);
    expect(result.picks.map((p) => [p.lot_id, p.quantity])).toEqual([
      ["sooner", 100],
      ["later", 50],
    ]);
    expect(result.shortfall).toBe(0);
  });

  it("orders null expiry last and uses received_date as tiebreaker", () => {
    const result = suggestFifoAllocations(250, [
      lot({ lot_id: "no-expiry", remaining_quantity: 100, received_date: "2026-01-01" }),
      lot({
        lot_id: "expiring-new",
        remaining_quantity: 100,
        expiration_date: "2026-08-01",
        received_date: "2026-03-01",
      }),
      lot({
        lot_id: "expiring-old",
        remaining_quantity: 100,
        expiration_date: "2026-08-01",
        received_date: "2026-02-01",
      }),
    ]);
    expect(result.picks.map((p) => p.lot_id)).toEqual([
      "expiring-old",
      "expiring-new",
      "no-expiry",
    ]);
    expect(result.shortfall).toBe(0);
  });

  it("reports shortfall when lots cannot cover the requirement", () => {
    const result = suggestFifoAllocations(120, [
      lot({ lot_id: "a", remaining_quantity: 50 }),
    ]);
    expect(result.picks).toHaveLength(1);
    expect(result.picks[0].quantity).toBe(50);
    expect(result.shortfall).toBe(70);
  });

  it("skips empty lots and carries lot unit cost", () => {
    const result = suggestFifoAllocations(10, [
      lot({ lot_id: "empty", remaining_quantity: 0 }),
      lot({ lot_id: "full", remaining_quantity: 20, unit_cost: 1.5 }),
    ]);
    expect(result.picks).toEqual([
      { lot_id: "full", lot_number: "full", quantity: 10, unit_cost: 1.5 },
    ]);
  });

  it("does not mutate the input lot array", () => {
    const lots = [
      lot({ lot_id: "b", expiration_date: "2026-12-01" }),
      lot({ lot_id: "a", expiration_date: "2026-07-01" }),
    ];
    suggestFifoAllocations(50, lots);
    expect(lots[0].lot_id).toBe("b");
  });
});

describe("compareFifoLots", () => {
  it("sorts identical lots as equal", () => {
    const a = lot({ lot_id: "a", expiration_date: "2026-07-01", received_date: "2026-01-01" });
    const b = lot({ lot_id: "b", expiration_date: "2026-07-01", received_date: "2026-01-01" });
    expect(compareFifoLots(a, b)).toBe(0);
  });
});

describe("recipeScaleFactor", () => {
  it("scales by batch volume over recipe batch size", () => {
    expect(recipeScaleFactor(15, 10)).toBe(1.5);
  });

  it("returns 1 when data is missing or invalid", () => {
    expect(recipeScaleFactor(null, 10)).toBe(1);
    expect(recipeScaleFactor(10, null)).toBe(1);
    expect(recipeScaleFactor(10, 0)).toBe(1);
    expect(recipeScaleFactor(0, 10)).toBe(1);
  });
});

describe("convertIngredientQuantity", () => {
  it("converts oz to lbs", () => {
    expect(convertIngredientQuantity(16, "oz", "lbs")).toBeCloseTo(1);
  });

  it("converts lbs to kg", () => {
    expect(convertIngredientQuantity(1, "lbs", "kg")).toBeCloseTo(0.4536, 3);
  });

  it("is case-insensitive and treats lb/lbs as equal", () => {
    expect(convertIngredientQuantity(5, "LB", "lbs")).toBe(5);
  });

  it("returns the same quantity for identical units", () => {
    expect(convertIngredientQuantity(3, "each", "each")).toBe(3);
  });

  it("returns null for unconvertible units", () => {
    expect(convertIngredientQuantity(3, "lbs", "each")).toBeNull();
    expect(convertIngredientQuantity(3, null, "lbs")).toBeNull();
  });
});

describe("computeBomConsumption", () => {
  it("multiplies BOM lines by actual quantity and sums per item", () => {
    const result = computeBomConsumption(
      [
        { selling_format_id: "case24", actual_quantity: 100 },
        { selling_format_id: "case24", actual_quantity: 50 },
      ],
      [
        { selling_format_id: "case24", inventory_item_id: "can", quantity_per_unit: 24, unit: "each" },
        { selling_format_id: "case24", inventory_item_id: "glue", quantity_per_unit: 0.1, unit: "oz" },
      ]
    );
    expect(result.get("can")).toBe(3600);
    expect(result.get("glue")).toBeCloseTo(15);
  });

  it("uses integer ratio math for whole units to avoid precision drift", () => {
    // 1/24 stored as 0.0417 — naive math gives 4800 * 0.0417 = 200.16 → ceil 201
    const result = computeBomConsumption(
      [{ selling_format_id: "f", actual_quantity: 4800 }],
      [{ selling_format_id: "f", inventory_item_id: "tray", quantity_per_unit: 0.0417, unit: "each" }]
    );
    expect(result.get("tray")).toBe(200);
  });

  it("ceils fractional whole-unit totals", () => {
    const result = computeBomConsumption(
      [{ selling_format_id: "f", actual_quantity: 10 }],
      [{ selling_format_id: "f", inventory_item_id: "tray", quantity_per_unit: 0.25, unit: "each" }]
    );
    expect(result.get("tray")).toBe(3); // 2.5 → 3
  });

  it("skips line items without format or actual quantity", () => {
    const result = computeBomConsumption(
      [
        { selling_format_id: null, actual_quantity: 10 },
        { selling_format_id: "f", actual_quantity: null },
        { selling_format_id: "f", actual_quantity: 0 },
      ],
      [{ selling_format_id: "f", inventory_item_id: "x", quantity_per_unit: 1, unit: "each" }]
    );
    expect(result.size).toBe(0);
  });
});

describe("computeTransferLoss", () => {
  it("returns the volume left behind", () => {
    expect(computeTransferLoss(10, 9.5)).toBeCloseTo(0.5);
  });

  it("returns 0 for negative or epsilon differences", () => {
    expect(computeTransferLoss(10, 10)).toBe(0);
    expect(computeTransferLoss(10, 10.5)).toBe(0);
    expect(computeTransferLoss(10, 9.999)).toBe(0); // below epsilon
    expect(computeTransferLoss(null, 5)).toBe(0);
  });
});

describe("computePackagingLoss", () => {
  it("computes per-batch loss volume from planned vs actual", () => {
    const result = computePackagingLoss([
      // 100 planned, 90 actual, 1/8 bbl per unit → 1.25 bbl loss
      { batch_id: "b1", planned_quantity: 100, actual_quantity: 90, unit_volume_bbl: 0.125 },
      { batch_id: "b1", planned_quantity: 10, actual_quantity: 10, unit_volume_bbl: 0.125 },
      { batch_id: "b2", planned_quantity: 50, actual_quantity: 48, unit_volume_bbl: 0.5 },
    ]);
    expect(result.get("b1")).toBeCloseTo(1.25);
    expect(result.get("b2")).toBeCloseTo(1);
  });

  it("skips overruns, missing data, and epsilon-sized losses", () => {
    const result = computePackagingLoss([
      { batch_id: "b1", planned_quantity: 90, actual_quantity: 100, unit_volume_bbl: 0.125 },
      { batch_id: "b2", planned_quantity: 100, actual_quantity: null, unit_volume_bbl: 0.125 },
      { batch_id: "b3", planned_quantity: 100, actual_quantity: 90, unit_volume_bbl: null },
      { batch_id: null, planned_quantity: 100, actual_quantity: 90, unit_volume_bbl: 0.125 },
      { batch_id: "b4", planned_quantity: 100, actual_quantity: 99.999, unit_volume_bbl: 0.001 },
    ]);
    expect(result.size).toBe(0);
  });
});
