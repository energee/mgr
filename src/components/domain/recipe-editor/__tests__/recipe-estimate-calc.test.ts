/**
 * Unit tests for recipe estimate calculations.
 *
 * Validates OG, FG, ABV, IBU, SRM formulas match the SQL view
 * (recipes_with_estimates) and handle edge cases correctly.
 */

import { describe, it, expect } from "vitest";
import {
  calculateEstimates,
  getHopUtilizationFactor,
  type EstimateGrainItem,
  type EstimateHopItem,
} from "../recipe-estimate-calc";

describe("getHopUtilizationFactor", () => {
  // Tinseth formula at default gravity (1.050):
  //   bigness = 1.65 * 0.000125^(1.050 - 1) ≈ 1.2756
  //   boilFactor(t) = (1 - e^(-0.04*t)) / 4.15

  it("returns correct Tinseth utilization for boil timing", () => {
    expect(getHopUtilizationFactor("boil", 60)).toBeCloseTo(0.2307, 3);
    expect(getHopUtilizationFactor("boil", 45)).toBeCloseTo(0.2117, 3);
    expect(getHopUtilizationFactor("boil", 30)).toBeCloseTo(0.1773, 3);
    expect(getHopUtilizationFactor("boil", 15)).toBeCloseTo(0.1145, 3);
    expect(getHopUtilizationFactor("boil", 10)).toBeCloseTo(0.0836, 3);
    expect(getHopUtilizationFactor("boil", 5)).toBeCloseTo(0.0460, 3);
    expect(getHopUtilizationFactor("boil", 3)).toBeCloseTo(0.0287, 3);
  });

  it("defaults to 60 min boil when not specified", () => {
    const expected = getHopUtilizationFactor("boil", 60);
    expect(getHopUtilizationFactor("boil", null)).toBeCloseTo(expected, 4);
    expect(getHopUtilizationFactor("boil", undefined)).toBeCloseTo(expected, 4);
  });

  it("returns correct factors for non-boil timings", () => {
    // first_wort uses full 60-min boil utilization (same as Tinseth at 60 min)
    expect(getHopUtilizationFactor("first_wort")).toBeCloseTo(
      getHopUtilizationFactor("boil", 60), 4
    );
    expect(getHopUtilizationFactor("whirlpool")).toBe(0.05);
    expect(getHopUtilizationFactor("mash")).toBe(0.08);
  });

  it("returns 0 for dry hop and unknown timings", () => {
    expect(getHopUtilizationFactor("dry_hop")).toBe(0);
    expect(getHopUtilizationFactor("unknown")).toBe(0);
  });
});

describe("calculateEstimates", () => {
  // Typical American IPA grain bill: 12 lbs 2-row (37 ppg, 1.8L) at 7 BBL
  const typicalGrains: EstimateGrainItem[] = [
    { weight_lbs: 372, potential_ppg: 37, color_lovibond: 1.8 },
    { weight_lbs: 31, potential_ppg: 34, color_lovibond: 20 },
  ];

  const typicalHops: EstimateHopItem[] = [
    { weight_oz: 16, alpha_acid: 13, timing: "boil", boil_time_min: 60 },
    { weight_oz: 16, alpha_acid: 13, timing: "whirlpool", boil_time_min: null },
  ];

  it("calculates OG from grain bill and batch size", () => {
    const result = calculateEstimates({
      grainItems: typicalGrains,
      hopItems: [],
      batchSizeBbl: 7,
      mashEfficiency: 75,
      targetAttenuation: 75,
    });

    expect(result.og).not.toBeNull();
    // 7 BBL = 217 gal; (372*37 + 31*34) * 75/100 / 217 / 1000
    // = (13764 + 1054) * 0.75 / 217 / 1000 = 14818 * 0.75 / 217 / 1000
    // = 11113.5 / 217 / 1000 = 51.21 / 1000 = 0.05121
    // OG = 1 + 0.051 = 1.051
    expect(result.og).toBeCloseTo(1.051, 2);
  });

  it("calculates FG from OG and attenuation", () => {
    const result = calculateEstimates({
      grainItems: typicalGrains,
      hopItems: [],
      batchSizeBbl: 7,
      mashEfficiency: 75,
      targetAttenuation: 75,
    });

    expect(result.fg).not.toBeNull();
    // FG = 1 + (OG-1) * (1 - 0.75) = 1 + 0.051 * 0.25 ≈ 1.013
    expect(result.fg).toBeCloseTo(1.013, 2);
  });

  it("calculates ABV from gravity and attenuation", () => {
    const result = calculateEstimates({
      grainItems: typicalGrains,
      hopItems: [],
      batchSizeBbl: 7,
      mashEfficiency: 75,
      targetAttenuation: 75,
    });

    expect(result.abv).not.toBeNull();
    // ABV ≈ 5.0-5.1%
    expect(result.abv!).toBeGreaterThan(4);
    expect(result.abv!).toBeLessThan(7);
  });

  it("calculates IBU from hop schedule", () => {
    const result = calculateEstimates({
      grainItems: typicalGrains,
      hopItems: typicalHops,
      batchSizeBbl: 7,
      mashEfficiency: 75,
      targetAttenuation: 75,
    });

    expect(result.ibu).not.toBeNull();
    // Tinseth utilization: ~0.231 for 60min boil, ~0.05 for whirlpool
    // IBU contributions summed and scaled by batch volume
    // Result falls in the 15-50 range for this grain/hop combination
    expect(result.ibu!).toBeGreaterThan(15);
    expect(result.ibu!).toBeLessThan(50);
  });

  it("calculates SRM from grain color", () => {
    const result = calculateEstimates({
      grainItems: typicalGrains,
      hopItems: [],
      batchSizeBbl: 7,
      mashEfficiency: 75,
    });

    expect(result.srm).not.toBeNull();
    // MCU = (372*1.8 + 31*20) = 669.6 + 620 = 1289.6
    // SRM = 1.4922 * (1289.6 / 217) ^ 0.6859 = 1.4922 * 5.94 ^ 0.6859
    expect(result.srm!).toBeGreaterThan(3);
    expect(result.srm!).toBeLessThan(20);
  });

  it("returns all nulls for empty grain bill", () => {
    const result = calculateEstimates({
      grainItems: [],
      hopItems: typicalHops,
      batchSizeBbl: 7,
    });

    expect(result.og).toBeNull();
    expect(result.fg).toBeNull();
    expect(result.abv).toBeNull();
    expect(result.srm).toBeNull();
    // IBU should still calculate from hops
    expect(result.ibu).not.toBeNull();
  });

  it("returns null IBU when no hops", () => {
    const result = calculateEstimates({
      grainItems: typicalGrains,
      hopItems: [],
      batchSizeBbl: 7,
    });

    expect(result.ibu).toBeNull();
    // Other values should be present
    expect(result.og).not.toBeNull();
  });

  it("uses default efficiency (75) when not specified", () => {
    const result = calculateEstimates({
      grainItems: typicalGrains,
      hopItems: [],
      batchSizeBbl: 7,
    });

    const resultExplicit = calculateEstimates({
      grainItems: typicalGrains,
      hopItems: [],
      batchSizeBbl: 7,
      mashEfficiency: 75,
    });

    expect(result.og).toBe(resultExplicit.og);
  });

  it("uses default attenuation (75) when not specified", () => {
    const result = calculateEstimates({
      grainItems: typicalGrains,
      hopItems: [],
      batchSizeBbl: 7,
    });

    const resultExplicit = calculateEstimates({
      grainItems: typicalGrains,
      hopItems: [],
      batchSizeBbl: 7,
      targetAttenuation: 75,
    });

    expect(result.fg).toBe(resultExplicit.fg);
  });

  it("falls back to volumeBbl when batchSizeBbl is null", () => {
    const result = calculateEstimates({
      grainItems: typicalGrains,
      hopItems: [],
      batchSizeBbl: null,
      volumeBbl: 7,
    });

    const resultDirect = calculateEstimates({
      grainItems: typicalGrains,
      hopItems: [],
      batchSizeBbl: 7,
    });

    expect(result.og).toBe(resultDirect.og);
  });

  it("falls back to 1 BBL when both size fields are null", () => {
    const result = calculateEstimates({
      grainItems: [{ weight_lbs: 10, potential_ppg: 37, color_lovibond: 2 }],
      hopItems: [],
      batchSizeBbl: null,
      volumeBbl: null,
    });

    // 10 * 37 * 75/100 / 31 / 1000 = 370 * 0.75 / 31 / 1000 = 0.00895
    // OG = 1.009
    expect(result.og).not.toBeNull();
    expect(result.og!).toBeGreaterThan(1.0);
  });

  it("handles zero batch size by falling back to 1 BBL", () => {
    const result = calculateEstimates({
      grainItems: [{ weight_lbs: 10, potential_ppg: 37, color_lovibond: 2 }],
      hopItems: [],
      batchSizeBbl: 0,
    });

    expect(result.og).not.toBeNull();
  });

  it("uses default PPG and color when grain catalog data is missing", () => {
    const result = calculateEstimates({
      grainItems: [{ weight_lbs: 100, potential_ppg: null, color_lovibond: null }],
      hopItems: [],
      batchSizeBbl: 7,
    });

    // Default PPG = 36, default color = 2
    expect(result.og).not.toBeNull();
    expect(result.srm).not.toBeNull();
  });

  it("uses default alpha acid when hop catalog data is missing", () => {
    const hops: EstimateHopItem[] = [
      { weight_oz: 2, alpha_acid: null, timing: "boil", boil_time_min: 60 },
    ];

    const result = calculateEstimates({
      grainItems: typicalGrains,
      hopItems: hops,
      batchSizeBbl: 7,
    });

    // Default alpha = 10
    // 2 * 10 * 0.27 = 5.4; * 74.89 / 217 = 1.86 ≈ 2 IBU
    expect(result.ibu).not.toBeNull();
    expect(result.ibu!).toBeGreaterThan(0);
  });

  it("adjusts hop utilization based on calculated OG (gravity correction)", () => {
    const highGravityGrains: EstimateGrainItem[] = [
      { weight_lbs: 600, potential_ppg: 37, color_lovibond: 2 },
    ];
    const lowGravityGrains: EstimateGrainItem[] = [
      { weight_lbs: 200, potential_ppg: 37, color_lovibond: 2 },
    ];
    const hops: EstimateHopItem[] = [
      { weight_oz: 16, alpha_acid: 13, timing: "boil", boil_time_min: 60 },
    ];

    const highGravity = calculateEstimates({
      grainItems: highGravityGrains, hopItems: hops, batchSizeBbl: 7, mashEfficiency: 75,
    });
    const lowGravity = calculateEstimates({
      grainItems: lowGravityGrains, hopItems: hops, batchSizeBbl: 7, mashEfficiency: 75,
    });

    // Higher gravity reduces hop utilization, so IBU should be lower
    const highUtil = getHopUtilizationFactor("boil", 60, highGravity.og);
    const lowUtil = getHopUtilizationFactor("boil", 60, lowGravity.og);
    expect(highUtil).toBeLessThan(lowUtil);
  });

  it("first_wort utilization matches 60-min boil at same gravity", () => {
    const gravity = 1.055;
    expect(getHopUtilizationFactor("first_wort", null, gravity))
      .toBeCloseTo(getHopUtilizationFactor("boil", 60, gravity), 6);
  });

  it("applies consistent rounding: OG/FG 3dp, ABV/SRM 1dp, IBU integer", () => {
    const result = calculateEstimates({
      grainItems: [{ weight_lbs: 372, potential_ppg: 37, color_lovibond: 5 }],
      hopItems: [{ weight_oz: 16, alpha_acid: 13, timing: "boil", boil_time_min: 60 }],
      batchSizeBbl: 7, mashEfficiency: 75, targetAttenuation: 75,
    });
    expect(result.og!.toString().split(".")[1]?.length).toBeLessThanOrEqual(3);
    expect(result.fg!.toString().split(".")[1]?.length).toBeLessThanOrEqual(3);
    expect(result.abv!.toString().split(".")[1]?.length).toBeLessThanOrEqual(1);
    expect(result.srm!.toString().split(".")[1]?.length).toBeLessThanOrEqual(1);
    expect(Number.isInteger(result.ibu)).toBe(true);
  });

  it("dry hop additions do not contribute to IBU", () => {
    const dryHops: EstimateHopItem[] = [
      { weight_oz: 32, alpha_acid: 13, timing: "dry_hop", boil_time_min: null },
    ];

    const result = calculateEstimates({
      grainItems: typicalGrains,
      hopItems: dryHops,
      batchSizeBbl: 7,
    });

    expect(result.ibu).toBeNull();
  });
});
