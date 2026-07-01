/**
 * Characterization tests for consumption-planning pure logic: FIFO lot
 * allocation, recipe scale factor, BOM consumption aggregation, and implied
 * loss math for transfers and packaging (src/domain/consumption-planning.ts).
 */

import { describe, it, expect } from "vitest";
import {
  compareFifoLots,
  suggestFifoAllocations,
  recipeScaleFactor,
  computeBomConsumption,
  computeTransferLoss,
  computePackagingLoss,
  LOSS_EPSILON_BBL,
  type FifoLot,
  type BomLine,
  type ConsumptionLineItem,
  type PackagingLossLine,
} from "../consumption-planning";

function makeLot(overrides: Partial<FifoLot>): FifoLot {
  return {
    lot_id: "lot-1",
    lot_number: "L1",
    remaining_quantity: 10,
    expiration_date: null,
    received_date: null,
    unit_cost: null,
    ...overrides,
  };
}

describe("LOSS_EPSILON_BBL", () => {
  it("is 0.005", () => {
    expect(LOSS_EPSILON_BBL).toBe(0.005);
  });
});

describe("compareFifoLots", () => {
  it("sorts sooner expiration first", () => {
    const a = makeLot({ lot_id: "a", expiration_date: "2026-01-01" });
    const b = makeLot({ lot_id: "b", expiration_date: "2026-06-01" });
    expect(compareFifoLots(a, b)).toBe(-1);
    expect(compareFifoLots(b, a)).toBe(1);
  });

  it("treats null expiration as last", () => {
    const withDate = makeLot({ lot_id: "a", expiration_date: "2026-01-01" });
    const noDate = makeLot({ lot_id: "b", expiration_date: null });
    expect(compareFifoLots(noDate, withDate)).toBe(1);
    expect(compareFifoLots(withDate, noDate)).toBe(-1);
  });

  it("falls back to received_date when expiration dates match", () => {
    const older = makeLot({
      lot_id: "a",
      expiration_date: "2026-01-01",
      received_date: "2025-01-01",
    });
    const newer = makeLot({
      lot_id: "b",
      expiration_date: "2026-01-01",
      received_date: "2025-06-01",
    });
    expect(compareFifoLots(older, newer)).toBe(-1);
    expect(compareFifoLots(newer, older)).toBe(1);
  });

  it("treats null received_date as last when expiration dates match", () => {
    const withReceived = makeLot({
      lot_id: "a",
      expiration_date: "2026-01-01",
      received_date: "2025-01-01",
    });
    const noReceived = makeLot({
      lot_id: "b",
      expiration_date: "2026-01-01",
      received_date: null,
    });
    expect(compareFifoLots(noReceived, withReceived)).toBe(1);
    expect(compareFifoLots(withReceived, noReceived)).toBe(-1);
  });

  it("returns 0 when both expiration and received dates match", () => {
    const a = makeLot({
      lot_id: "a",
      expiration_date: "2026-01-01",
      received_date: "2025-01-01",
    });
    const b = makeLot({
      lot_id: "b",
      expiration_date: "2026-01-01",
      received_date: "2025-01-01",
    });
    expect(compareFifoLots(a, b)).toBe(0);
  });

  it("returns 0 when both expiration and received dates are null", () => {
    const a = makeLot({ lot_id: "a" });
    const b = makeLot({ lot_id: "b" });
    expect(compareFifoLots(a, b)).toBe(0);
  });
});

describe("suggestFifoAllocations", () => {
  it("returns empty picks and zero shortfall for non-positive required quantity", () => {
    expect(suggestFifoAllocations(0, [makeLot({})])).toEqual({
      picks: [],
      shortfall: 0,
    });
    expect(suggestFifoAllocations(-5, [makeLot({})])).toEqual({
      picks: [],
      shortfall: 0,
    });
  });

  it("returns empty picks and zero shortfall for non-finite required quantity", () => {
    expect(suggestFifoAllocations(NaN, [makeLot({})])).toEqual({
      picks: [],
      shortfall: 0,
    });
    expect(suggestFifoAllocations(Infinity, [makeLot({})])).toEqual({
      picks: [],
      shortfall: 0,
    });
  });

  it("draws from a single lot fully covering the requirement", () => {
    const lot = makeLot({ lot_id: "a", remaining_quantity: 10, unit_cost: 2.5 });
    const result = suggestFifoAllocations(4, [lot]);
    expect(result).toEqual({
      picks: [{ lot_id: "a", lot_number: "L1", quantity: 4, unit_cost: 2.5 }],
      shortfall: 0,
    });
  });

  it("splits across lots in FIFO (soonest expiration) order", () => {
    const later = makeLot({
      lot_id: "later",
      remaining_quantity: 10,
      expiration_date: "2026-06-01",
    });
    const sooner = makeLot({
      lot_id: "sooner",
      remaining_quantity: 5,
      expiration_date: "2026-01-01",
    });
    const result = suggestFifoAllocations(8, [later, sooner]);
    expect(result.picks).toEqual([
      { lot_id: "sooner", lot_number: "L1", quantity: 5, unit_cost: null },
      { lot_id: "later", lot_number: "L1", quantity: 3, unit_cost: null },
    ]);
    expect(result.shortfall).toBe(0);
  });

  it("skips lots with zero or negative remaining quantity", () => {
    const empty = makeLot({ lot_id: "empty", remaining_quantity: 0 });
    const negative = makeLot({ lot_id: "negative", remaining_quantity: -3 });
    const usable = makeLot({ lot_id: "usable", remaining_quantity: 10 });
    const result = suggestFifoAllocations(4, [empty, negative, usable]);
    expect(result.picks).toEqual([
      { lot_id: "usable", lot_number: "L1", quantity: 4, unit_cost: null },
    ]);
    expect(result.shortfall).toBe(0);
  });

  it("skips lots with non-finite remaining quantity", () => {
    const bad = makeLot({ lot_id: "bad", remaining_quantity: NaN });
    const usable = makeLot({ lot_id: "usable", remaining_quantity: 10 });
    const result = suggestFifoAllocations(4, [bad, usable]);
    expect(result.picks).toEqual([
      { lot_id: "usable", lot_number: "L1", quantity: 4, unit_cost: null },
    ]);
  });

  it("reports shortfall when lots cannot fully cover the requirement", () => {
    const lot = makeLot({ lot_id: "a", remaining_quantity: 3 });
    const result = suggestFifoAllocations(10, [lot]);
    expect(result.picks).toEqual([
      { lot_id: "a", lot_number: "L1", quantity: 3, unit_cost: null },
    ]);
    expect(result.shortfall).toBe(7);
  });

  it("returns full shortfall and no picks with no lots available", () => {
    const result = suggestFifoAllocations(5, []);
    expect(result).toEqual({ picks: [], shortfall: 5 });
  });

  it("clamps tiny float residue shortfall to zero", () => {
    // Three lots of 1/3 each: floating point sum may leave 1e-16 residue.
    const lots = [
      makeLot({ lot_id: "a", remaining_quantity: 1 / 3 }),
      makeLot({ lot_id: "b", remaining_quantity: 1 / 3 }),
      makeLot({ lot_id: "c", remaining_quantity: 1 / 3 }),
    ];
    const result = suggestFifoAllocations(1, lots);
    expect(result.shortfall).toBe(0);
  });

  it("defaults unit_cost to null when the lot omits it", () => {
    const lot = makeLot({ lot_id: "a", remaining_quantity: 5 });
    delete (lot as { unit_cost?: number | null }).unit_cost;
    const result = suggestFifoAllocations(2, [lot]);
    expect(result.picks[0].unit_cost).toBeNull();
  });

  it("does not mutate the input lots array order", () => {
    const later = makeLot({ lot_id: "later", expiration_date: "2026-06-01" });
    const sooner = makeLot({ lot_id: "sooner", expiration_date: "2026-01-01" });
    const lots = [later, sooner];
    suggestFifoAllocations(1, lots);
    expect(lots[0].lot_id).toBe("later");
    expect(lots[1].lot_id).toBe("sooner");
  });
});

describe("recipeScaleFactor", () => {
  it("returns the ratio of batch volume to recipe batch size", () => {
    expect(recipeScaleFactor(20, 10)).toBe(2);
    expect(recipeScaleFactor(5, 10)).toBe(0.5);
  });

  it("returns 1 when batch volume is null or undefined", () => {
    expect(recipeScaleFactor(null, 10)).toBe(1);
    expect(recipeScaleFactor(undefined, 10)).toBe(1);
  });

  it("returns 1 when recipe batch size is null or undefined", () => {
    expect(recipeScaleFactor(10, null)).toBe(1);
    expect(recipeScaleFactor(10, undefined)).toBe(1);
  });

  it("returns 1 when either value is non-finite", () => {
    expect(recipeScaleFactor(NaN, 10)).toBe(1);
    expect(recipeScaleFactor(10, Infinity)).toBe(1);
  });

  it("returns 1 when either value is zero or negative", () => {
    expect(recipeScaleFactor(0, 10)).toBe(1);
    expect(recipeScaleFactor(10, 0)).toBe(1);
    expect(recipeScaleFactor(-5, 10)).toBe(1);
    expect(recipeScaleFactor(10, -5)).toBe(1);
  });
});

describe("computeBomConsumption", () => {
  it("aggregates fractional (non-whole-unit) consumption across line items", () => {
    const lineItems: ConsumptionLineItem[] = [
      { selling_format_id: "fmt-1", actual_quantity: 10 },
    ];
    const bomLines: BomLine[] = [
      { selling_format_id: "fmt-1", inventory_item_id: "co2", quantity_per_unit: 0.02, unit: "kg" },
    ];
    const result = computeBomConsumption(lineItems, bomLines);
    expect(result.get("co2")).toBeCloseTo(0.2);
  });

  it("uses exact integer ratio math for whole-unit BOM lines and ceils the result", () => {
    // 0.25 -> 1/4 ratio: 10 units of format require 10 * 1/4 = 2.5 -> ceil 3
    const lineItems: ConsumptionLineItem[] = [
      { selling_format_id: "fmt-1", actual_quantity: 10 },
    ];
    const bomLines: BomLine[] = [
      { selling_format_id: "fmt-1", inventory_item_id: "tray", quantity_per_unit: 0.25, unit: "each" },
    ];
    const result = computeBomConsumption(lineItems, bomLines);
    expect(result.get("tray")).toBe(3);
  });

  it("does not ceil away an exact whole-unit integer result (epsilon guard)", () => {
    // 1 unit per format, 4 units packaged -> exactly 4, should stay 4 not round up.
    const lineItems: ConsumptionLineItem[] = [
      { selling_format_id: "fmt-1", actual_quantity: 4 },
    ];
    const bomLines: BomLine[] = [
      { selling_format_id: "fmt-1", inventory_item_id: "case", quantity_per_unit: 1, unit: "case" },
    ];
    const result = computeBomConsumption(lineItems, bomLines);
    expect(result.get("case")).toBe(4);
  });

  it("falls back to decimal math for whole units when no clean ratio is found", () => {
    // An irrational-ish decimal with no clean ratio within tolerance/maxDen
    // falls back to quantity_per_unit * actual_quantity, still ceiled.
    const oddDecimal = 0.123456789;
    const lineItems: ConsumptionLineItem[] = [
      { selling_format_id: "fmt-1", actual_quantity: 3 },
    ];
    const bomLines: BomLine[] = [
      { selling_format_id: "fmt-1", inventory_item_id: "widget", quantity_per_unit: oddDecimal, unit: "each" },
    ];
    const result = computeBomConsumption(lineItems, bomLines);
    expect(result.get("widget")).toBe(Math.ceil(oddDecimal * 3 - 1e-9));
  });

  it("sums consumption across multiple line items for the same format", () => {
    const lineItems: ConsumptionLineItem[] = [
      { selling_format_id: "fmt-1", actual_quantity: 5 },
      { selling_format_id: "fmt-1", actual_quantity: 3 },
    ];
    const bomLines: BomLine[] = [
      { selling_format_id: "fmt-1", inventory_item_id: "malt", quantity_per_unit: 2, unit: "lb" },
    ];
    const result = computeBomConsumption(lineItems, bomLines);
    expect(result.get("malt")).toBe(16);
  });

  it("sums consumption for the same inventory item across multiple BOM lines", () => {
    const lineItems: ConsumptionLineItem[] = [
      { selling_format_id: "fmt-1", actual_quantity: 2 },
      { selling_format_id: "fmt-2", actual_quantity: 3 },
    ];
    const bomLines: BomLine[] = [
      { selling_format_id: "fmt-1", inventory_item_id: "lid", quantity_per_unit: 1, unit: "each" },
      { selling_format_id: "fmt-2", inventory_item_id: "lid", quantity_per_unit: 1, unit: "each" },
    ];
    const result = computeBomConsumption(lineItems, bomLines);
    expect(result.get("lid")).toBe(5);
  });

  it("skips line items with no selling_format_id", () => {
    const lineItems: ConsumptionLineItem[] = [
      { selling_format_id: null, actual_quantity: 10 },
    ];
    const bomLines: BomLine[] = [
      { selling_format_id: "fmt-1", inventory_item_id: "malt", quantity_per_unit: 1, unit: "lb" },
    ];
    const result = computeBomConsumption(lineItems, bomLines);
    expect(result.size).toBe(0);
  });

  it("skips line items with null actual_quantity", () => {
    const lineItems: ConsumptionLineItem[] = [
      { selling_format_id: "fmt-1", actual_quantity: null },
    ];
    const bomLines: BomLine[] = [
      { selling_format_id: "fmt-1", inventory_item_id: "malt", quantity_per_unit: 1, unit: "lb" },
    ];
    const result = computeBomConsumption(lineItems, bomLines);
    expect(result.size).toBe(0);
  });

  it("skips line items with zero or negative actual_quantity", () => {
    const lineItems: ConsumptionLineItem[] = [
      { selling_format_id: "fmt-1", actual_quantity: 0 },
      { selling_format_id: "fmt-1", actual_quantity: -1 },
    ];
    const bomLines: BomLine[] = [
      { selling_format_id: "fmt-1", inventory_item_id: "malt", quantity_per_unit: 1, unit: "lb" },
    ];
    const result = computeBomConsumption(lineItems, bomLines);
    expect(result.size).toBe(0);
  });

  it("ignores line items whose format has no matching BOM lines", () => {
    const lineItems: ConsumptionLineItem[] = [
      { selling_format_id: "unknown-fmt", actual_quantity: 10 },
    ];
    const bomLines: BomLine[] = [
      { selling_format_id: "fmt-1", inventory_item_id: "malt", quantity_per_unit: 1, unit: "lb" },
    ];
    const result = computeBomConsumption(lineItems, bomLines);
    expect(result.size).toBe(0);
  });

  it("returns an empty map for empty inputs", () => {
    expect(computeBomConsumption([], []).size).toBe(0);
  });

  it("omits inventory items whose final consumption is not greater than zero", () => {
    // quantity_per_unit is 0, so required consumption is always 0 -> excluded.
    const lineItems: ConsumptionLineItem[] = [
      { selling_format_id: "fmt-1", actual_quantity: 10 },
    ];
    const bomLines: BomLine[] = [
      { selling_format_id: "fmt-1", inventory_item_id: "free-item", quantity_per_unit: 0, unit: "lb" },
    ];
    const result = computeBomConsumption(lineItems, bomLines);
    expect(result.has("free-item")).toBe(false);
  });
});

describe("computeTransferLoss", () => {
  it("returns 0 when remaining volume is null or undefined", () => {
    expect(computeTransferLoss(null, 10)).toBe(0);
    expect(computeTransferLoss(undefined, 10)).toBe(0);
  });

  it("returns 0 when remaining volume is non-finite", () => {
    expect(computeTransferLoss(NaN, 10)).toBe(0);
  });

  it("returns the difference when loss exceeds the epsilon", () => {
    expect(computeTransferLoss(10.1, 10)).toBeCloseTo(0.1);
  });

  it("returns 0 when the difference is within the epsilon boundary (inclusive)", () => {
    // remaining - transferred === LOSS_EPSILON_BBL exactly (transferred is 0
    // so the subtraction is exact in floating point): strictly-greater
    // comparison means the boundary itself does not count as loss.
    expect(computeTransferLoss(LOSS_EPSILON_BBL, 0)).toBe(0);
  });

  it("returns a positive value just above the epsilon boundary", () => {
    const loss = computeTransferLoss(10 + LOSS_EPSILON_BBL + 0.001, 10);
    expect(loss).toBeCloseTo(LOSS_EPSILON_BBL + 0.001);
  });

  it("returns 0 when transferred volume exceeds remaining volume (negative diff)", () => {
    expect(computeTransferLoss(5, 10)).toBe(0);
  });
});

describe("computePackagingLoss", () => {
  it("computes loss volume for a single valid line", () => {
    const lines: PackagingLossLine[] = [
      { batch_id: "batch-1", planned_quantity: 100, actual_quantity: 90, unit_volume_bbl: 0.01 },
    ];
    const result = computePackagingLoss(lines);
    expect(result.get("batch-1")).toBeCloseTo(0.1);
  });

  it("sums loss across multiple lines for the same batch", () => {
    const lines: PackagingLossLine[] = [
      { batch_id: "batch-1", planned_quantity: 100, actual_quantity: 90, unit_volume_bbl: 0.01 },
      { batch_id: "batch-1", planned_quantity: 50, actual_quantity: 40, unit_volume_bbl: 0.01 },
    ];
    const result = computePackagingLoss(lines);
    expect(result.get("batch-1")).toBeCloseTo(0.2);
  });

  it("keeps separate totals per batch", () => {
    const lines: PackagingLossLine[] = [
      { batch_id: "batch-1", planned_quantity: 100, actual_quantity: 90, unit_volume_bbl: 0.01 },
      { batch_id: "batch-2", planned_quantity: 100, actual_quantity: 80, unit_volume_bbl: 0.01 },
    ];
    const result = computePackagingLoss(lines);
    expect(result.get("batch-1")).toBeCloseTo(0.1);
    expect(result.get("batch-2")).toBeCloseTo(0.2);
  });

  it("skips lines with no batch_id", () => {
    const lines: PackagingLossLine[] = [
      { batch_id: null, planned_quantity: 100, actual_quantity: 90, unit_volume_bbl: 0.01 },
    ];
    expect(computePackagingLoss(lines).size).toBe(0);
  });

  it("skips lines with missing planned, actual, or unit volume data", () => {
    const lines: PackagingLossLine[] = [
      { batch_id: "batch-1", planned_quantity: null, actual_quantity: 90, unit_volume_bbl: 0.01 },
      { batch_id: "batch-1", planned_quantity: 100, actual_quantity: null, unit_volume_bbl: 0.01 },
      { batch_id: "batch-1", planned_quantity: 100, actual_quantity: 90, unit_volume_bbl: null },
    ];
    expect(computePackagingLoss(lines).size).toBe(0);
  });

  it("skips lines with zero or negative unit_volume_bbl", () => {
    const lines: PackagingLossLine[] = [
      { batch_id: "batch-1", planned_quantity: 100, actual_quantity: 90, unit_volume_bbl: 0 },
      { batch_id: "batch-1", planned_quantity: 100, actual_quantity: 90, unit_volume_bbl: -0.01 },
    ];
    expect(computePackagingLoss(lines).size).toBe(0);
  });

  it("skips lines where actual quantity meets or exceeds planned (no loss)", () => {
    const lines: PackagingLossLine[] = [
      { batch_id: "batch-1", planned_quantity: 100, actual_quantity: 100, unit_volume_bbl: 0.01 },
      { batch_id: "batch-1", planned_quantity: 100, actual_quantity: 110, unit_volume_bbl: 0.01 },
    ];
    expect(computePackagingLoss(lines).size).toBe(0);
  });

  it("drops batch totals at or below the loss epsilon", () => {
    // lossUnits * unit_volume_bbl == LOSS_EPSILON_BBL exactly -> dropped (<=).
    const lines: PackagingLossLine[] = [
      { batch_id: "batch-1", planned_quantity: 1, actual_quantity: 0, unit_volume_bbl: LOSS_EPSILON_BBL },
    ];
    expect(computePackagingLoss(lines).size).toBe(0);
  });

  it("keeps batch totals just above the loss epsilon", () => {
    const lines: PackagingLossLine[] = [
      {
        batch_id: "batch-1",
        planned_quantity: 1,
        actual_quantity: 0,
        unit_volume_bbl: LOSS_EPSILON_BBL + 0.001,
      },
    ];
    const result = computePackagingLoss(lines);
    expect(result.get("batch-1")).toBeCloseTo(LOSS_EPSILON_BBL + 0.001);
  });

  it("returns an empty map for empty input", () => {
    expect(computePackagingLoss([]).size).toBe(0);
  });
});
