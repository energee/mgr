// @vitest-environment node
/**
 * Tests for the brewing water-chemistry calculations (sulfate:chloride
 * ratio, salt ion contributions, resulting-profile math) in
 * src/domain/water-chemistry.ts.
 */

import { describe, it, expect } from "vitest";
import {
  calculateSulfateChlorideRatio,
  formatRatio,
  calculateIonContribution,
  calculateResultingProfile,
  SALT_CONTRIBUTIONS,
  type WaterProfile,
  type SaltAdditions,
} from "@/domain/water-chemistry";

const ZERO_PROFILE: WaterProfile = {
  calcium_ppm: 0,
  magnesium_ppm: 0,
  sodium_ppm: 0,
  sulfate_ppm: 0,
  chloride_ppm: 0,
  bicarbonate_ppm: 0,
};

const ZERO_ADDITIONS: SaltAdditions = {
  gypsum_g: 0,
  calcium_chloride_g: 0,
  epsom_salt_g: 0,
  baking_soda_g: 0,
  chalk_g: 0,
  table_salt_g: 0,
  magnesium_chloride_g: 0,
};

describe("calculateSulfateChlorideRatio", () => {
  it("computes and rounds sulfate:chloride to one decimal", () => {
    expect(calculateSulfateChlorideRatio(150, 45)).toBe(3.3);
    expect(calculateSulfateChlorideRatio(50, 100)).toBe(0.5);
  });

  it("returns Infinity when chloride is zero, regardless of sulfate", () => {
    expect(calculateSulfateChlorideRatio(200, 0)).toBe(Infinity);
    expect(calculateSulfateChlorideRatio(0, 0)).toBe(Infinity);
  });
});

describe("formatRatio", () => {
  it("formats a finite ratio as 'N:1'", () => {
    expect(formatRatio(3.3)).toBe("3.3:1");
  });

  it("formats Infinity as the infinity symbol", () => {
    expect(formatRatio(Infinity)).toBe("∞:1");
  });
});

describe("calculateIonContribution", () => {
  it("derives calcium/sulfate ppm from gypsum's SALT_CONTRIBUTIONS constants", () => {
    const grams = 10;
    const volumeGal = 5;
    const factor = grams / volumeGal;
    const result = calculateIonContribution("gypsum", grams, volumeGal);
    expect(result.calcium_ppm).toBe(SALT_CONTRIBUTIONS.gypsum.calcium * factor);
    expect(result.sulfate_ppm).toBe(SALT_CONTRIBUTIONS.gypsum.sulfate * factor);
  });

  it("derives sodium/chloride ppm from table_salt's SALT_CONTRIBUTIONS constants", () => {
    const grams = 8;
    const volumeGal = 4;
    const factor = grams / volumeGal;
    const result = calculateIonContribution("table_salt", grams, volumeGal);
    expect(result.sodium_ppm).toBe(SALT_CONTRIBUTIONS.table_salt.sodium * factor);
    expect(result.chloride_ppm).toBe(SALT_CONTRIBUTIONS.table_salt.chloride * factor);
  });

  it("converts chalk's carbonate contribution to bicarbonate at a 1.22 ratio", () => {
    const grams = 10;
    const volumeGal = 10;
    const factor = grams / volumeGal;
    const result = calculateIonContribution("chalk", grams, volumeGal);
    expect(result.calcium_ppm).toBe(SALT_CONTRIBUTIONS.chalk.calcium * factor);
    expect(result.bicarbonate_ppm).toBe(
      SALT_CONTRIBUTIONS.chalk.carbonate * factor * 1.22
    );
  });

  it("produces Infinity ppm values when volume is zero (divide-by-zero)", () => {
    const result = calculateIonContribution("epsom_salt", 5, 0);
    expect(result.magnesium_ppm).toBe(Infinity);
    expect(result.sulfate_ppm).toBe(Infinity);
  });
});

describe("calculateResultingProfile", () => {
  it("leaves the source profile unchanged when all salt additions are zero", () => {
    const source: WaterProfile = {
      calcium_ppm: 118,
      magnesium_ppm: 4,
      sodium_ppm: 12,
      sulfate_ppm: 54,
      chloride_ppm: 19,
      bicarbonate_ppm: 319,
    };
    expect(calculateResultingProfile(source, ZERO_ADDITIONS, 5)).toEqual(source);
  });

  it("adds gypsum's ion contribution on top of the source profile, rounded to 1 decimal", () => {
    // 10g gypsum / 3gal -> factor 10/3 -- chosen so the raw (unrounded)
    // products have more than 1 decimal place, so this test actually
    // exercises round1() rather than passing vacuously on already-exact
    // values. Raw calcium_ppm = 61.5 * 10/3 = 205.00000000000003 (rounds to
    // 205); raw sulfate_ppm = 147.4 * 10/3 = 491.33333333333337 (rounds to
    // 491.3). Literals below are the ROUNDED results, computed from
    // SALT_CONTRIBUTIONS and round1's actual semantics (Math.round(v*10)/10).
    const volumeGal = 3;
    const additions: SaltAdditions = { ...ZERO_ADDITIONS, gypsum_g: 10 };
    const result = calculateResultingProfile(ZERO_PROFILE, additions, volumeGal);
    expect(result.calcium_ppm).toBe(205);
    expect(result.sulfate_ppm).toBe(491.3);
    expect(result.chloride_ppm).toBe(0);
  });
});
