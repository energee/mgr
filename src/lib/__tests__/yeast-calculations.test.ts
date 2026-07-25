import { describe, it, expect } from "vitest";
import {
  calculateViabilityDecay,
  getViabilityStatus,
  daysUntilViabilityThreshold,
  calculatePitchingRate,
  calculatePitchWeightLbs,
  formatCellCount,
  shouldReplaceYeast,
} from "\@/domain/yeast-calculations";

// =============================================================================
// Viability Decay
// =============================================================================

describe("calculateViabilityDecay", () => {
  it("returns initial viability at day 0", () => {
    const result = calculateViabilityDecay(95, 0, "liquid");
    expect(result.viability).toBe(95);
    expect(result.daysOld).toBe(0);
  });

  it("decays liquid yeast faster than dry yeast", () => {
    const liquid = calculateViabilityDecay(95, 30, "liquid");
    const dry = calculateViabilityDecay(95, 30, "dry");
    expect(liquid.viability).toBeLessThan(dry.viability);
  });

  it("viability decreases over time", () => {
    const day0 = calculateViabilityDecay(95, 0, "liquid");
    const day30 = calculateViabilityDecay(95, 30, "liquid");
    const day60 = calculateViabilityDecay(95, 60, "liquid");
    expect(day30.viability).toBeLessThan(day0.viability);
    expect(day60.viability).toBeLessThan(day30.viability);
  });

  it("never goes below 0", () => {
    const result = calculateViabilityDecay(95, 1000, "liquid");
    expect(result.viability).toBeGreaterThanOrEqual(0);
  });

  it("defaults to liquid yeast", () => {
    const result = calculateViabilityDecay(95, 30);
    const liquid = calculateViabilityDecay(95, 30, "liquid");
    expect(result.viability).toBe(liquid.viability);
  });
});

// =============================================================================
// getViabilityStatus
// =============================================================================

describe("getViabilityStatus", () => {
  it("returns excellent for >= 90", () => {
    expect(getViabilityStatus(95)).toBe("excellent");
    expect(getViabilityStatus(90)).toBe("excellent");
  });

  it("returns good for >= 75", () => {
    expect(getViabilityStatus(80)).toBe("good");
    expect(getViabilityStatus(75)).toBe("good");
  });

  it("returns marginal for >= 50", () => {
    expect(getViabilityStatus(60)).toBe("marginal");
    expect(getViabilityStatus(50)).toBe("marginal");
  });

  it("returns low for >= 25", () => {
    expect(getViabilityStatus(30)).toBe("low");
    expect(getViabilityStatus(25)).toBe("low");
  });

  it("returns inactive for < 25", () => {
    expect(getViabilityStatus(20)).toBe("inactive");
    expect(getViabilityStatus(0)).toBe("inactive");
  });
});

// =============================================================================
// daysUntilViabilityThreshold
// =============================================================================

describe("daysUntilViabilityThreshold", () => {
  it("returns 0 if already below threshold", () => {
    expect(daysUntilViabilityThreshold(50, 60, "liquid")).toBe(0);
  });

  it("returns positive days for future threshold", () => {
    const days = daysUntilViabilityThreshold(95, 50, "liquid");
    expect(days).toBeGreaterThan(0);
  });

  it("dry yeast lasts longer than liquid", () => {
    const liquid = daysUntilViabilityThreshold(95, 50, "liquid");
    const dry = daysUntilViabilityThreshold(95, 50, "dry");
    expect(dry).toBeGreaterThan(liquid);
  });
});

// =============================================================================
// Cell Count Estimation
// =============================================================================



// =============================================================================
// Pitching Rate
// =============================================================================

describe("calculatePitchingRate", () => {
  it("calculates cells needed for ale (in thousands)", () => {
    const result = calculatePitchingRate(7, 12, "ale");
    expect(result.cellsNeeded).toBeGreaterThan(0);
    // 7 BBL ale at 12P should need hundreds of billions = hundreds of millions of thousands
    expect(result.cellsNeeded).toBeGreaterThan(100_000_000);
  });

  it("lager needs more cells than ale", () => {
    const ale = calculatePitchingRate(7, 12, "ale");
    const lager = calculatePitchingRate(7, 12, "lager");
    expect(lager.cellsNeeded).toBeGreaterThan(ale.cellsNeeded);
  });

  it("higher gravity needs more cells", () => {
    const low = calculatePitchingRate(7, 10, "ale");
    const high = calculatePitchingRate(7, 18, "ale");
    expect(high.cellsNeeded).toBeGreaterThan(low.cellsNeeded);
  });

  it("recommends starter when cells are insufficient", () => {
    // Pass available cells in thousands: 50B = 50,000,000 thousand
    const result = calculatePitchingRate(7, 12, "ale", 50_000_000);
    // 7 BBL ale at 12P needs a lot of cells
    expect(result.starterRecommended).toBe(true);
  });

  it("does not recommend starter when cells are sufficient", () => {
    // Small batch with lots of cells available (5000B = 5,000,000,000 thousand)
    const result = calculatePitchingRate(0.5, 10, "ale", 5_000_000_000_000);
    expect(result.starterRecommended).toBe(false);
  });
});

// =============================================================================
// Weight-Based Pitching
// =============================================================================

describe("calculatePitchWeightLbs", () => {
  it("calculates correct lbs for normal case", () => {
    // Need 500,000,000 thousand cells, density 100,000,000 thousand/lb, 90% viability
    // Viable per lb = 100,000,000 * 0.9 = 90,000,000
    // lbs = 500,000,000 / 90,000,000 = 5.555... -> ceil to 5.6
    const lbs = calculatePitchWeightLbs(500_000_000, 100_000_000, 90);
    expect(lbs).toBe(5.6);
  });

  it("returns 0 when density is zero", () => {
    expect(calculatePitchWeightLbs(500_000_000, 0, 90)).toBe(0);
  });

  it("returns 0 when viability is zero", () => {
    expect(calculatePitchWeightLbs(500_000_000, 100_000_000, 0)).toBe(0);
  });

  it("rounds up to nearest 0.1 lb", () => {
    // Need 100,000,000 thousand cells, density 100,000,000 thousand/lb, 95% viability
    // Viable per lb = 100,000,000 * 0.95 = 95,000,000
    // lbs = 100,000,000 / 95,000,000 = 1.0526... -> ceil to 1.1
    const lbs = calculatePitchWeightLbs(100_000_000, 100_000_000, 95);
    expect(lbs).toBe(1.1);
  });

  it("returns exact value when division is clean", () => {
    // Need 100,000,000 thousand cells, density 100,000,000 thousand/lb, 100% viability
    // lbs = 100,000,000 / 100,000,000 = 1.0 exactly
    const lbs = calculatePitchWeightLbs(100_000_000, 100_000_000, 100);
    expect(lbs).toBe(1.0);
  });
});

// =============================================================================
// Cell Count Formatting
// =============================================================================

describe("formatCellCount", () => {
  it("formats billions: 1,000,000 thousand -> '1B'", () => {
    expect(formatCellCount(1_000_000)).toBe("1B");
  });

  it("formats billions with decimals: 1,500,000 thousand -> '1.5B'", () => {
    expect(formatCellCount(1_500_000)).toBe("1.5B");
  });

  it("formats millions: 1,000 thousand -> '1M'", () => {
    expect(formatCellCount(1_000)).toBe("1M");
  });

  it("formats millions with decimals: 450,500 thousand -> '450.5M'", () => {
    expect(formatCellCount(450_500)).toBe("450.5M");
  });

  it("formats thousands: 500 -> '500K'", () => {
    expect(formatCellCount(500)).toBe("500K");
  });

  it("formats small thousands: 1 -> '1K'", () => {
    expect(formatCellCount(1)).toBe("1K");
  });

  it("strips trailing zeros in billions: 2,000,000 thousand -> '2B'", () => {
    expect(formatCellCount(2_000_000)).toBe("2B");
  });

  it("strips trailing zeros in millions: 100,000 thousand -> '100M'", () => {
    expect(formatCellCount(100_000)).toBe("100M");
  });
});

// =============================================================================
// Generation / Replacement
// =============================================================================

describe("shouldReplaceYeast", () => {
  it("recommends replacement at max generation", () => {
    const result = shouldReplaceYeast(8);
    expect(result.replace).toBe(true);
  });

  it("does not recommend replacement at low generation", () => {
    const result = shouldReplaceYeast(2);
    expect(result.replace).toBe(false);
    expect(result.reason).toBeNull();
  });

  it("warns when approaching max generation", () => {
    const result = shouldReplaceYeast(6); // default max is 8
    expect(result.replace).toBe(false);
    expect(result.reason).not.toBeNull();
    expect(result.reason).toContain("approaching");
  });

  it("respects strain-specific max generations", () => {
    const lager = shouldReplaceYeast(9, "lager");
    expect(lager.replace).toBe(false); // lager max is 10

    const belgian = shouldReplaceYeast(6, "belgian");
    expect(belgian.replace).toBe(true); // belgian max is 6
  });
});

// =============================================================================
// Harvest Estimation
// =============================================================================


// =============================================================================
// Post-Harvest Viability
// =============================================================================

