import { describe, it, expect } from "vitest";
import {
  isWholeUnit,
  ratioFromDecimal,
  WHOLE_UNIT_VALUES,
} from "\@/domain/inventory-units";

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

