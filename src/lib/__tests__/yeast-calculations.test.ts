import { describe, it, expect } from "vitest";
import {
  calculateViabilityDecay,
  getViabilityStatus,
  daysUntilViabilityThreshold,
  estimateCellsFromPackage,
  estimateCellsFromSlurry,
  calculatePitchingRate,
  shouldReplaceYeast,
  estimateHarvestVolume,
  estimatePostHarvestViability,
} from "../yeast-calculations";

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

describe("estimateCellsFromPackage", () => {
  it("estimates 100B cells for fresh liquid pack", () => {
    const result = estimateCellsFromPackage("liquid", 1, 100);
    expect(result.cellsBillion).toBe(100);
  });

  it("estimates 200B cells for fresh dry packet", () => {
    const result = estimateCellsFromPackage("dry", 1, 100);
    expect(result.cellsBillion).toBe(200);
  });

  it("scales with package count", () => {
    const one = estimateCellsFromPackage("liquid", 1, 95);
    const two = estimateCellsFromPackage("liquid", 2, 95);
    expect(two.cellsBillion).toBeCloseTo(one.cellsBillion * 2, 1);
  });

  it("reduces cells with lower viability", () => {
    const high = estimateCellsFromPackage("liquid", 1, 95);
    const low = estimateCellsFromPackage("liquid", 1, 50);
    expect(low.cellsBillion).toBeLessThan(high.cellsBillion);
  });

  it("confidence is high for good viability", () => {
    expect(estimateCellsFromPackage("liquid", 1, 90).confidence).toBe("high");
  });

  it("confidence is medium for moderate viability", () => {
    expect(estimateCellsFromPackage("liquid", 1, 60).confidence).toBe(
      "medium"
    );
  });

  it("confidence is low for poor viability", () => {
    expect(estimateCellsFromPackage("liquid", 1, 40).confidence).toBe("low");
  });
});

describe("estimateCellsFromSlurry", () => {
  it("dense slurry has more cells per mL", () => {
    const dense = estimateCellsFromSlurry(100, "dense", 85);
    const thin = estimateCellsFromSlurry(100, "thin", 85);
    expect(dense.cellsBillion).toBeGreaterThan(thin.cellsBillion);
  });

  it("scales with volume", () => {
    const small = estimateCellsFromSlurry(100, "medium", 85);
    const large = estimateCellsFromSlurry(200, "medium", 85);
    expect(large.cellsBillion).toBeCloseTo(small.cellsBillion * 2, 1);
  });
});

// =============================================================================
// Pitching Rate
// =============================================================================

describe("calculatePitchingRate", () => {
  it("calculates cells needed for ale", () => {
    const result = calculatePitchingRate(7, 12, "ale");
    expect(result.cellsNeeded).toBeGreaterThan(0);
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
    const result = calculatePitchingRate(7, 12, "ale", 50);
    // 7 BBL ale at 12P needs a lot of cells
    if (result.cellsNeeded > 100) {
      expect(result.starterRecommended).toBe(true);
    }
  });

  it("does not recommend starter when cells are sufficient", () => {
    // Small batch with lots of cells available
    const result = calculatePitchingRate(0.5, 10, "ale", 5000);
    expect(result.starterRecommended).toBe(false);
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

describe("estimateHarvestVolume", () => {
  it("cone fermenters yield more than flat-bottom", () => {
    const cone = estimateHarvestVolume(7, "medium", "cone");
    const flat = estimateHarvestVolume(7, "medium", "flat");
    expect(cone.volumeMlMax).toBeGreaterThan(flat.volumeMlMax);
  });

  it("high flocculation yields more", () => {
    const high = estimateHarvestVolume(7, "high", "cone");
    const low = estimateHarvestVolume(7, "low", "cone");
    expect(high.volumeMlMax).toBeGreaterThan(low.volumeMlMax);
  });

  it("scales with batch volume", () => {
    const small = estimateHarvestVolume(3, "medium", "cone");
    const large = estimateHarvestVolume(6, "medium", "cone");
    expect(large.volumeMlMin).toBeCloseTo(small.volumeMlMin * 2, -1);
  });
});

// =============================================================================
// Post-Harvest Viability
// =============================================================================

describe("estimatePostHarvestViability", () => {
  it("returns ~95% for ideal conditions", () => {
    const viability = estimatePostHarvestViability(66, 5, 7);
    expect(viability).toBe(95);
  });

  it("reduces viability for high temp", () => {
    const normal = estimatePostHarvestViability(66, 5, 7);
    const hot = estimatePostHarvestViability(80, 5, 7);
    expect(hot).toBeLessThan(normal);
  });

  it("reduces viability for high alcohol", () => {
    const low = estimatePostHarvestViability(66, 5, 7);
    const high = estimatePostHarvestViability(66, 10, 7);
    expect(high).toBeLessThan(low);
  });

  it("reduces viability for extended contact time", () => {
    const short = estimatePostHarvestViability(66, 5, 7);
    const long = estimatePostHarvestViability(66, 5, 30);
    expect(long).toBeLessThan(short);
  });

  it("never goes below 50%", () => {
    const viability = estimatePostHarvestViability(100, 15, 60);
    expect(viability).toBeGreaterThanOrEqual(50);
  });

  it("never exceeds 95%", () => {
    const viability = estimatePostHarvestViability(60, 3, 5);
    expect(viability).toBeLessThanOrEqual(95);
  });
});
