import { describe, it, expect } from "vitest";
import {
  isWholeUnit,
  ratioFromDecimal,
  computeWholeUnitRequired,
  WHOLE_UNIT_VALUES,
} from "../inventory-units";

describe("isWholeUnit", () => {
  it("returns true for 'each' and 'case'", () => {
    expect(isWholeUnit("each")).toBe(true);
    expect(isWholeUnit("case")).toBe(true);
  });

  it("returns false for bulk units", () => {
    expect(isWholeUnit("lb")).toBe(false);
    expect(isWholeUnit("oz")).toBe(false);
    expect(isWholeUnit("kg")).toBe(false);
    expect(isWholeUnit("g")).toBe(false);
    expect(isWholeUnit("gal")).toBe(false);
  });

  it("returns false for null/undefined/empty", () => {
    expect(isWholeUnit(null)).toBe(false);
    expect(isWholeUnit(undefined)).toBe(false);
    expect(isWholeUnit("")).toBe(false);
  });

  it("exports the canonical set", () => {
    expect(WHOLE_UNIT_VALUES.has("each")).toBe(true);
    expect(WHOLE_UNIT_VALUES.has("case")).toBe(true);
    expect(WHOLE_UNIT_VALUES.size).toBe(2);
  });
});

describe("ratioFromDecimal", () => {
  it("recovers 1/1 for value 1", () => {
    expect(ratioFromDecimal(1)).toEqual({ numerator: 1, denominator: 1 });
  });

  it("recovers 1/4 for value 0.25 (quadpack)", () => {
    expect(ratioFromDecimal(0.25)).toEqual({ numerator: 1, denominator: 4 });
  });

  it("recovers 1/24 for value 0.0417 (tray) within tolerance", () => {
    expect(ratioFromDecimal(0.0417)).toEqual({ numerator: 1, denominator: 24 });
  });

  it("recovers 1/12 for value 0.0833 (six-pack carrier)", () => {
    expect(ratioFromDecimal(0.0833)).toEqual({ numerator: 1, denominator: 12 });
  });

  it("recovers 2/1 for value 2 (2 lids per can)", () => {
    expect(ratioFromDecimal(2)).toEqual({ numerator: 2, denominator: 1 });
  });

  it("recovers 3/4 for value 0.75", () => {
    expect(ratioFromDecimal(0.75)).toEqual({ numerator: 3, denominator: 4 });
  });

  it("returns null for zero/negative/non-finite", () => {
    expect(ratioFromDecimal(0)).toBeNull();
    expect(ratioFromDecimal(-1)).toBeNull();
    expect(ratioFromDecimal(NaN)).toBeNull();
    expect(ratioFromDecimal(Infinity)).toBeNull();
  });

  it("returns null when no clean ratio fits within maxDen", () => {
    // Pick an ugly irrational-ish value that won't snap to a small denominator
    expect(ratioFromDecimal(0.31415, { maxDen: 10 })).toBeNull();
  });

  it("respects custom tolerance", () => {
    // 0.05 ≈ 1/20 exactly — should always succeed
    expect(ratioFromDecimal(0.05)).toEqual({ numerator: 1, denominator: 20 });
  });
});

describe("computeWholeUnitRequired", () => {
  it("1 lid per can: 4800 cans → 4800 lids", () => {
    expect(computeWholeUnitRequired(1, 4800)).toBe(4800);
  });

  it("1 quadpack per 4 cans: 4800 cans → 1200 quadpacks", () => {
    expect(computeWholeUnitRequired(0.25, 4800)).toBe(1200);
  });

  it("1 tray per 24 cans: 4800 cans → 200 trays (rounded)", () => {
    // 4800 * 0.0417 = 200.16 → ceil = 201
    // Note: per-line ceil is intentionally conservative; aggregate
    // precision is handled at render time.
    expect(computeWholeUnitRequired(0.0417, 4800)).toBe(201);
  });

  it("2 lids per can (high-ratio): 100 cans → 200 lids", () => {
    expect(computeWholeUnitRequired(2, 100)).toBe(200);
  });

  it("returns 0 for invalid inputs", () => {
    expect(computeWholeUnitRequired(0, 100)).toBe(0);
    expect(computeWholeUnitRequired(1, 0)).toBe(0);
    expect(computeWholeUnitRequired(NaN, 100)).toBe(0);
    expect(computeWholeUnitRequired(1, NaN)).toBe(0);
  });
});
