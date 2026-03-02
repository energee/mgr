/**
 * Unit tests for calculateDelta utility.
 *
 * Covers standard percentage change, zero-previous edge cases,
 * negative deltas, and identical values.
 */

import { describe, it, expect } from "vitest";
import { calculateDelta } from "../stat-card-with-delta";

describe("calculateDelta", () => {
  it("returns positive percentage for increase", () => {
    expect(calculateDelta(150, 100)).toBe(50);
  });

  it("returns negative percentage for decrease", () => {
    expect(calculateDelta(75, 100)).toBe(-25);
  });

  it("returns 0 when values are equal", () => {
    expect(calculateDelta(100, 100)).toBe(0);
  });

  it("returns 100 when previous is 0 and current is positive", () => {
    expect(calculateDelta(42, 0)).toBe(100);
  });

  it("returns null when both values are 0", () => {
    expect(calculateDelta(0, 0)).toBeNull();
  });

  it("handles fractional values correctly", () => {
    const result = calculateDelta(1.5, 1.0);
    expect(result).toBeCloseTo(50);
  });

  it("handles large percentage changes", () => {
    expect(calculateDelta(1000, 1)).toBe(99900);
  });

  it("handles decrease to zero from nonzero previous", () => {
    expect(calculateDelta(0, 100)).toBe(-100);
  });
});
