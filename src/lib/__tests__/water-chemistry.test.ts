import { describe, it, expect } from "vitest";
import {
  calculateSulfateChlorideRatio,
  getRatioDescription,
  calculateIonContribution,
  calculateResultingProfile,
  SALT_ADDITIVE_MAP,
  mapSaltAdditionsToItems,
  type WaterProfile,
  type SaltAdditions,
} from "\@/domain/water-chemistry";

// =============================================================================
// calculateSulfateChlorideRatio
// =============================================================================

describe("calculateSulfateChlorideRatio", () => {
  it("calculates correct ratio", () => {
    expect(calculateSulfateChlorideRatio(200, 100)).toBe(2);
  });

  it("returns Infinity for zero chloride", () => {
    expect(calculateSulfateChlorideRatio(200, 0)).toBe(Infinity);
  });

  it("returns 0 for zero sulfate", () => {
    expect(calculateSulfateChlorideRatio(0, 100)).toBe(0);
  });

  it("rounds to one decimal", () => {
    // 150 / 70 = 2.142... -> 2.1
    expect(calculateSulfateChlorideRatio(150, 70)).toBe(2.1);
  });
});

// =============================================================================
// getRatioDescription
// =============================================================================

describe("getRatioDescription", () => {
  it("returns Very Hoppy for ratio >= 2.5", () => {
    expect(getRatioDescription(3).label).toBe("Very Hoppy");
  });

  it("returns Hoppy for ratio >= 1.5", () => {
    expect(getRatioDescription(2).label).toBe("Hoppy");
  });

  it("returns Balanced for ratio ~1", () => {
    expect(getRatioDescription(1).label).toBe("Balanced");
  });

  it("returns Malty for ratio ~0.5", () => {
    expect(getRatioDescription(0.5).label).toBe("Malty");
  });

  it("returns Very Malty for ratio < 0.4", () => {
    expect(getRatioDescription(0.3).label).toBe("Very Malty");
  });
});

// =============================================================================
// calculateIonContribution
// =============================================================================

describe("calculateIonContribution", () => {
  it("calculates gypsum contributions", () => {
    const result = calculateIonContribution("gypsum", 1, 1);
    expect(result.calcium_ppm).toBeCloseTo(61.5, 1);
    expect(result.sulfate_ppm).toBeCloseTo(147.4, 1);
    expect(result.chloride_ppm).toBeUndefined();
  });

  it("calculates calcium chloride contributions", () => {
    const result = calculateIonContribution("calcium_chloride", 1, 1);
    expect(result.calcium_ppm).toBeCloseTo(72, 1);
    expect(result.chloride_ppm).toBeCloseTo(127, 1);
  });

  it("scales with grams", () => {
    const result1 = calculateIonContribution("gypsum", 1, 5);
    const result2 = calculateIonContribution("gypsum", 2, 5);
    expect(result2.calcium_ppm).toBeCloseTo(result1.calcium_ppm! * 2, 5);
  });

  it("scales inversely with volume", () => {
    const result1 = calculateIonContribution("gypsum", 1, 5);
    const result2 = calculateIonContribution("gypsum", 1, 10);
    expect(result2.calcium_ppm).toBeCloseTo(result1.calcium_ppm! / 2, 5);
  });
});

// =============================================================================
// calculateResultingProfile
// =============================================================================

describe("calculateResultingProfile", () => {
  const distilled: WaterProfile = {
    calcium_ppm: 0,
    magnesium_ppm: 0,
    sodium_ppm: 0,
    sulfate_ppm: 0,
    chloride_ppm: 0,
    bicarbonate_ppm: 0,
  };

  const noAdditions: SaltAdditions = {
    gypsum_g: 0,
    calcium_chloride_g: 0,
    epsom_salt_g: 0,
    baking_soda_g: 0,
    chalk_g: 0,
    table_salt_g: 0,
    magnesium_chloride_g: 0,
  };

  it("returns source profile when no additions", () => {
    const result = calculateResultingProfile(distilled, noAdditions, 5);
    expect(result.calcium_ppm).toBe(0);
    expect(result.sulfate_ppm).toBe(0);
  });

  it("adds gypsum contributions correctly", () => {
    const additions = { ...noAdditions, gypsum_g: 5 };
    const result = calculateResultingProfile(distilled, additions, 5);
    expect(result.calcium_ppm).toBeGreaterThan(0);
    expect(result.sulfate_ppm).toBeGreaterThan(0);
    expect(result.chloride_ppm).toBe(0);
  });

  it("accumulates from source profile", () => {
    const source: WaterProfile = {
      ...distilled,
      calcium_ppm: 50,
    };
    const additions = { ...noAdditions, gypsum_g: 1 };
    const result = calculateResultingProfile(source, additions, 5);
    expect(result.calcium_ppm).toBeGreaterThan(50);
  });
});

// =============================================================================
// calculateResidualAlkalinity
// =============================================================================


// =============================================================================
// estimateMashPH
// =============================================================================


// =============================================================================
// getIonRecommendations
// =============================================================================


// =============================================================================
// COMMON_PROFILES
// =============================================================================


// =============================================================================
// SALT_ADDITIVE_MAP
// =============================================================================

describe("SALT_ADDITIVE_MAP", () => {
  it("maps all SaltAdditions keys to additive names", () => {
    const saltKeys: (keyof SaltAdditions)[] = [
      "gypsum_g", "calcium_chloride_g", "epsom_salt_g",
      "baking_soda_g", "chalk_g", "table_salt_g", "magnesium_chloride_g",
    ];
    for (const key of saltKeys) {
      expect(SALT_ADDITIVE_MAP[key]).toBeDefined();
      expect(typeof SALT_ADDITIVE_MAP[key]).toBe("string");
    }
  });
});

// =============================================================================
// mapSaltAdditionsToItems
// =============================================================================

describe("mapSaltAdditionsToItems", () => {
  const mockCatalog = [
    { id: "gypsum-id", name: "Gypsum" },
    { id: "cacl2-id", name: "Calcium Chloride" },
    { id: "epsom-id", name: "Epsom Salt" },
    { id: "bsoda-id", name: "Baking Soda" },
    { id: "chalk-id", name: "Chalk" },
    { id: "tsalt-id", name: "Table Salt" },
    { id: "mgcl2-id", name: "Magnesium Chloride" },
  ];

  it("returns items for non-zero additions only", () => {
    const additions: SaltAdditions = {
      gypsum_g: 2.5, calcium_chloride_g: 1.0, epsom_salt_g: 0,
      baking_soda_g: 0, chalk_g: 0, table_salt_g: 0, magnesium_chloride_g: 0,
    };
    const items = mapSaltAdditionsToItems(additions, mockCatalog);
    expect(items).toHaveLength(2);
    expect(items[0].additive_id).toBe("gypsum-id");
    expect(items[0].amount).toBe(2.5);
    expect(items[0].unit).toBe("g");
    expect(items[1].additive_id).toBe("cacl2-id");
  });

  it("returns empty array when all additions are zero", () => {
    const additions: SaltAdditions = {
      gypsum_g: 0, calcium_chloride_g: 0, epsom_salt_g: 0,
      baking_soda_g: 0, chalk_g: 0, table_salt_g: 0, magnesium_chloride_g: 0,
    };
    expect(mapSaltAdditionsToItems(additions, mockCatalog)).toHaveLength(0);
  });

  it("skips salts not found in catalog", () => {
    const additions: SaltAdditions = {
      gypsum_g: 1, calcium_chloride_g: 0, epsom_salt_g: 0,
      baking_soda_g: 0, chalk_g: 0, table_salt_g: 0, magnesium_chloride_g: 0,
    };
    const items = mapSaltAdditionsToItems(additions, []);
    expect(items).toHaveLength(0);
  });
});
