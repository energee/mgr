import { describe, it, expect, vi } from "vitest";

// Mock the supabase client module before importing recipe-analyzer
// (recipe-analyzer.ts calls createClient() at module level)
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc: vi.fn(),
    from: vi.fn(),
  }),
}));

import {
  BrewingCalculations,
  WaterChemistry,
  FermentationAnalysis,
} from "../recipe-analyzer";

// =============================================================================
// BrewingCalculations.calculateOG
// =============================================================================

describe("BrewingCalculations.calculateOG", () => {
  it("calculates OG from a simple grain bill", () => {
    // 10 lbs of 2-row (37 PPG), 5 gal batch, 75% efficiency
    const grains = [{ weight_lbs: 10, ppg: 37 }];
    const og = BrewingCalculations.calculateOG(grains, 5, 75);
    // points = (10 * 37 * 0.75) / 5 = 55.5
    // OG = 1 + 55.5/1000 = 1.0555
    expect(og).toBeCloseTo(1.0555, 3);
  });

  it("calculates OG from a multi-grain bill", () => {
    const grains = [
      { weight_lbs: 9, ppg: 37 }, // 2-row
      { weight_lbs: 1, ppg: 33 }, // crystal 40
    ];
    const og = BrewingCalculations.calculateOG(grains, 5, 75);
    // totalPoints = 9*37 + 1*33 = 333 + 33 = 366
    // points = (366 * 0.75) / 5 = 54.9
    // OG = 1.0549
    expect(og).toBeCloseTo(1.0549, 3);
  });

  it("returns 1.000 for an empty grain bill", () => {
    const og = BrewingCalculations.calculateOG([], 5, 75);
    expect(og).toBe(1);
  });

  it("handles 100% efficiency", () => {
    const grains = [{ weight_lbs: 10, ppg: 37 }];
    const og = BrewingCalculations.calculateOG(grains, 5, 100);
    // points = (370 * 1.0) / 5 = 74
    expect(og).toBeCloseTo(1.074, 3);
  });

  it("handles 0% efficiency", () => {
    const grains = [{ weight_lbs: 10, ppg: 37 }];
    const og = BrewingCalculations.calculateOG(grains, 5, 0);
    expect(og).toBe(1);
  });
});

// =============================================================================
// BrewingCalculations.calculateFG
// =============================================================================

describe("BrewingCalculations.calculateFG", () => {
  it("calculates FG from OG and attenuation", () => {
    // OG 1.050, 75% attenuation
    const fg = BrewingCalculations.calculateFG(1.05, 75);
    // FG = 1 + (1.050 - 1) * (1 - 0.75) = 1 + 0.05 * 0.25 = 1.0125
    expect(fg).toBeCloseTo(1.0125, 4);
  });

  it("returns 1.000 for 100% attenuation", () => {
    const fg = BrewingCalculations.calculateFG(1.06, 100);
    expect(fg).toBeCloseTo(1.0, 4);
  });

  it("returns OG for 0% attenuation", () => {
    const fg = BrewingCalculations.calculateFG(1.06, 0);
    expect(fg).toBeCloseTo(1.06, 4);
  });
});

// =============================================================================
// BrewingCalculations.calculateABV
// =============================================================================

describe("BrewingCalculations.calculateABV", () => {
  it("calculates ABV from OG and FG", () => {
    // OG 1.050, FG 1.010
    const abv = BrewingCalculations.calculateABV(1.05, 1.01);
    // (1.050 - 1.010) * 131.25 = 5.25
    expect(abv).toBeCloseTo(5.25, 1);
  });

  it("returns 0 when OG equals FG", () => {
    const abv = BrewingCalculations.calculateABV(1.05, 1.05);
    expect(abv).toBeCloseTo(0, 4);
  });

  it("calculates high ABV correctly", () => {
    // OG 1.090, FG 1.015
    const abv = BrewingCalculations.calculateABV(1.09, 1.015);
    // (0.075) * 131.25 = 9.84375
    expect(abv).toBeCloseTo(9.84, 1);
  });
});

// =============================================================================
// BrewingCalculations.calculateIBU (Tinseth)
// =============================================================================

describe("BrewingCalculations.calculateIBU", () => {
  it("calculates IBU for a single hop addition", () => {
    const hops = [{ weight_oz: 1, alpha_acid: 10, boil_time_min: 60 }];
    const ibu = BrewingCalculations.calculateIBU(hops, 1.05, 5);
    // Should be a reasonable IBU value for 1oz at 10% AA, 60 min boil
    expect(ibu).toBeGreaterThan(20);
    expect(ibu).toBeLessThan(60);
  });

  it("calculates higher IBU for more hops", () => {
    const hops1 = [{ weight_oz: 1, alpha_acid: 10, boil_time_min: 60 }];
    const hops2 = [{ weight_oz: 2, alpha_acid: 10, boil_time_min: 60 }];
    const ibu1 = BrewingCalculations.calculateIBU(hops1, 1.05, 5);
    const ibu2 = BrewingCalculations.calculateIBU(hops2, 1.05, 5);
    expect(ibu2).toBeCloseTo(ibu1 * 2, 1);
  });

  it("calculates lower IBU for higher gravity (less utilization)", () => {
    const hops = [{ weight_oz: 1, alpha_acid: 10, boil_time_min: 60 }];
    const ibuLow = BrewingCalculations.calculateIBU(hops, 1.04, 5);
    const ibuHigh = BrewingCalculations.calculateIBU(hops, 1.08, 5);
    expect(ibuLow).toBeGreaterThan(ibuHigh);
  });

  it("calculates lower IBU for shorter boil times", () => {
    const hops60 = [{ weight_oz: 1, alpha_acid: 10, boil_time_min: 60 }];
    const hops15 = [{ weight_oz: 1, alpha_acid: 10, boil_time_min: 15 }];
    const ibu60 = BrewingCalculations.calculateIBU(hops60, 1.05, 5);
    const ibu15 = BrewingCalculations.calculateIBU(hops15, 1.05, 5);
    expect(ibu60).toBeGreaterThan(ibu15);
  });

  it("returns 0 for empty hop schedule", () => {
    const ibu = BrewingCalculations.calculateIBU([], 1.05, 5);
    expect(ibu).toBe(0);
  });

  it("returns 0 for 0-minute boil", () => {
    const hops = [{ weight_oz: 1, alpha_acid: 10, boil_time_min: 0 }];
    const ibu = BrewingCalculations.calculateIBU(hops, 1.05, 5);
    expect(ibu).toBeCloseTo(0, 1);
  });

  it("sums IBU from multiple hop additions", () => {
    const hops = [
      { weight_oz: 1, alpha_acid: 12, boil_time_min: 60 },
      { weight_oz: 0.5, alpha_acid: 5, boil_time_min: 15 },
      { weight_oz: 1, alpha_acid: 5, boil_time_min: 0 },
    ];
    const ibu = BrewingCalculations.calculateIBU(hops, 1.05, 5);
    expect(ibu).toBeGreaterThan(0);
  });
});

// =============================================================================
// BrewingCalculations.calculateSRM (Morey)
// =============================================================================

describe("BrewingCalculations.calculateSRM", () => {
  it("calculates SRM for a pale grain bill", () => {
    const grains = [{ weight_lbs: 10, color_lov: 2 }]; // pale malt
    const srm = BrewingCalculations.calculateSRM(grains, 5);
    // MCU = (10 * 2) / 5 = 4
    // SRM = 1.4922 * 4^0.6859 ~ 4.3
    expect(srm).toBeGreaterThan(3);
    expect(srm).toBeLessThan(6);
  });

  it("calculates higher SRM for darker grains", () => {
    const paleGrains = [{ weight_lbs: 10, color_lov: 2 }];
    const darkGrains = [{ weight_lbs: 10, color_lov: 40 }];
    const srmPale = BrewingCalculations.calculateSRM(paleGrains, 5);
    const srmDark = BrewingCalculations.calculateSRM(darkGrains, 5);
    expect(srmDark).toBeGreaterThan(srmPale);
  });

  it("handles multi-grain SRM calculation", () => {
    const grains = [
      { weight_lbs: 9, color_lov: 2 },
      { weight_lbs: 1, color_lov: 40 },
    ];
    const srm = BrewingCalculations.calculateSRM(grains, 5);
    // MCU = (9*2 + 1*40) / 5 = 58/5 = 11.6
    expect(srm).toBeGreaterThan(5);
    expect(srm).toBeLessThan(15);
  });

  it("returns 0 SRM for empty grain bill (via Morey)", () => {
    const srm = BrewingCalculations.calculateSRM([], 5);
    // MCU = 0, SRM = 1.4922 * 0^0.6859 = 0
    expect(srm).toBe(0);
  });
});

// =============================================================================
// BrewingCalculations gravity conversions
// =============================================================================

describe("BrewingCalculations gravity conversions", () => {
  it("converts SG to Plato", () => {
    const plato = BrewingCalculations.sgToPlato(1.048);
    expect(plato).toBeCloseTo(12, 0); // ~12 Plato
  });

  it("converts Plato to SG", () => {
    const sg = BrewingCalculations.platoToSG(12);
    expect(sg).toBeCloseTo(1.048, 2);
  });

  it("handles SG 1.000", () => {
    const plato = BrewingCalculations.sgToPlato(1.0);
    expect(plato).toBeCloseTo(0, 0);
  });
});

// =============================================================================
// WaterChemistry
// =============================================================================

describe("WaterChemistry", () => {
  describe("sulfateChlorideRatio", () => {
    it("calculates correct ratio", () => {
      expect(WaterChemistry.sulfateChlorideRatio(200, 100)).toBe(2);
    });

    it("returns Infinity when chloride is 0", () => {
      expect(WaterChemistry.sulfateChlorideRatio(200, 0)).toBe(Infinity);
    });

    it("returns 0 when sulfate is 0", () => {
      expect(WaterChemistry.sulfateChlorideRatio(0, 100)).toBe(0);
    });
  });

  describe("getRecommendedProfile", () => {
    it("returns hoppy profile for IPA styles", () => {
      const profile = WaterChemistry.getRecommendedProfile("American IPA");
      expect(profile.sulfate[0]).toBeGreaterThan(100);
    });

    it("returns malty profile for stout styles", () => {
      const profile = WaterChemistry.getRecommendedProfile("Irish Stout");
      expect(profile.chloride[0]).toBeGreaterThanOrEqual(100);
    });

    it("returns balanced profile for pilsner styles", () => {
      const profile = WaterChemistry.getRecommendedProfile("German Pilsner");
      expect(profile.sulfate[0]).toBeLessThan(100);
    });

    it("returns default profile for unknown styles", () => {
      const profile = WaterChemistry.getRecommendedProfile("Unknown Style XYZ");
      expect(profile).toBeDefined();
      expect(profile.sulfate).toBeDefined();
    });
  });

  describe("analyzeForStyle", () => {
    it("reports suitable water for matching profile", () => {
      const result = WaterChemistry.analyzeForStyle(
        { sulfate_ppm: 200, chloride_ppm: 75 },
        "IPA"
      );
      expect(result.suitable).toBe(true);
    });

    it("reports unsuitable water with recommendations", () => {
      const result = WaterChemistry.analyzeForStyle(
        { sulfate_ppm: 20, chloride_ppm: 20 },
        "IPA"
      );
      expect(result.suitable).toBe(false);
      expect(result.recommendation).toContain("sulfate");
    });
  });
});

// =============================================================================
// FermentationAnalysis
// =============================================================================

describe("FermentationAnalysis", () => {
  describe("validateFermentationTemp", () => {
    const yeast = { temp_min_f: 60, temp_max_f: 72 };

    it("returns valid for temperature within range", () => {
      const result = FermentationAnalysis.validateFermentationTemp(66, yeast);
      expect(result.valid).toBe(true);
    });

    it("returns invalid for temperature below range", () => {
      const result = FermentationAnalysis.validateFermentationTemp(55, yeast);
      expect(result.valid).toBe(false);
      expect(result.message).toContain("below");
    });

    it("returns invalid for temperature above range", () => {
      const result = FermentationAnalysis.validateFermentationTemp(80, yeast);
      expect(result.valid).toBe(false);
      expect(result.message).toContain("above");
    });

    it("returns valid at exact boundary temperatures", () => {
      expect(
        FermentationAnalysis.validateFermentationTemp(60, yeast).valid
      ).toBe(true);
      expect(
        FermentationAnalysis.validateFermentationTemp(72, yeast).valid
      ).toBe(true);
    });
  });

  describe("estimateTimeline", () => {
    it("estimates shorter timeline for low gravity ale", () => {
      const timeline = FermentationAnalysis.estimateTimeline(1.04, "ale");
      expect(timeline.primary_days).toBeLessThanOrEqual(7);
      expect(timeline.total_days).toBe(
        timeline.primary_days + timeline.conditioning_days
      );
    });

    it("estimates longer timeline for lagers", () => {
      const ale = FermentationAnalysis.estimateTimeline(1.05, "ale");
      const lager = FermentationAnalysis.estimateTimeline(1.05, "lager");
      expect(lager.total_days).toBeGreaterThan(ale.total_days);
    });

    it("estimates longer timeline for high gravity beers", () => {
      const low = FermentationAnalysis.estimateTimeline(1.04, "ale");
      const high = FermentationAnalysis.estimateTimeline(1.08, "ale");
      expect(high.primary_days).toBeGreaterThan(low.primary_days);
    });
  });
});
