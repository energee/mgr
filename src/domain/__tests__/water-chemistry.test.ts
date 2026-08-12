// @vitest-environment node
/**
 * Tests for the brewing water-chemistry calculations in
 * src/domain/water-chemistry.ts: sulfate:chloride ratio and its flavor
 * bands, salt ion contributions, resulting-profile math, the greedy
 * source→target salt solver, nullable-row normalization, and the
 * SaltAdditions → recipe_additions item mapping consumed by the recipe
 * additions "Apply to Recipe" write path.
 */

import { describe, it, expect } from "vitest";
import {
  calculateSulfateChlorideRatio,
  formatRatio,
  getRatioDescription,
  calculateIonContribution,
  calculateResultingProfile,
  calculateAdditions,
  toWaterProfile,
  mapSaltAdditionsToItems,
  SALT_CONTRIBUTIONS,
  SALT_ADDITIVE_MAP,
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
    // 10g gypsum / 3gal -> factor 10/3. Raw sulfate_ppm = 147.4 * (10/3)
    // = 491.33333333333337, so the 491.3 literal below is what actually
    // exercises round1() (calcium's raw 61.5 * (10/3) is exactly 205 in
    // IEEE-754 -- no rounding needed there). Literals are the ROUNDED
    // results per round1's semantics (Math.round(v*10)/10).
    const volumeGal = 3;
    const additions: SaltAdditions = { ...ZERO_ADDITIONS, gypsum_g: 10 };
    const result = calculateResultingProfile(ZERO_PROFILE, additions, volumeGal);
    expect(result.calcium_ppm).toBe(205);
    expect(result.sulfate_ppm).toBe(491.3);
    expect(result.chloride_ppm).toBe(0);
  });
});

describe("getRatioDescription", () => {
  // The five bands are inclusive at their lower bound; these cases pin each
  // boundary so a threshold tweak can't slide a ratio into the wrong band.
  it.each([
    [10, "Very Hoppy"],
    [2.5, "Very Hoppy"],
    [2.4, "Hoppy"],
    [1.5, "Hoppy"],
    [1.4, "Balanced"],
    [0.8, "Balanced"],
    [0.7, "Malty"],
    [0.4, "Malty"],
    [0.3, "Very Malty"],
    [0, "Very Malty"],
  ])("labels ratio %s as %s", (ratio, label) => {
    expect(getRatioDescription(ratio).label).toBe(label);
  });

  it("returns a non-empty character blurb alongside every label", () => {
    for (const ratio of [3, 2, 1, 0.5, 0]) {
      expect(getRatioDescription(ratio).character.length).toBeGreaterThan(0);
    }
  });
});

describe("calculateAdditions", () => {
  it("derives gypsum from the sulfate delta and calcium chloride from the chloride delta", () => {
    const target: WaterProfile = {
      ...ZERO_PROFILE,
      sulfate_ppm: 100,
      chloride_ppm: 50,
    };
    const result = calculateAdditions(ZERO_PROFILE, target, 10);

    expect(result.gypsum_g).toBe(
      Math.round((1000 / SALT_CONTRIBUTIONS.gypsum.sulfate) * 10) / 10
    );
    expect(result.calcium_chloride_g).toBe(
      Math.round((500 / SALT_CONTRIBUTIONS.calcium_chloride.chloride) * 10) / 10
    );
  });

  it("adds nothing when the target is at or below the source (deltas floor at zero)", () => {
    const source: WaterProfile = {
      calcium_ppm: 100,
      magnesium_ppm: 20,
      sodium_ppm: 30,
      sulfate_ppm: 200,
      chloride_ppm: 100,
      bicarbonate_ppm: 50,
    };
    expect(calculateAdditions(source, ZERO_PROFILE, 10)).toEqual(ZERO_ADDITIONS);
  });

  it("uses epsom salt for magnesium and baking soda for bicarbonate", () => {
    const target: WaterProfile = {
      ...ZERO_PROFILE,
      magnesium_ppm: 10,
      bicarbonate_ppm: 60,
    };
    const result = calculateAdditions(ZERO_PROFILE, target, 10);

    expect(result.epsom_salt_g).toBe(
      Math.round((100 / SALT_CONTRIBUTIONS.epsom_salt.magnesium) * 10) / 10
    );
    expect(result.baking_soda_g).toBe(
      Math.round((600 / SALT_CONTRIBUTIONS.baking_soda.bicarbonate) * 10) / 10
    );
  });

  it("only reaches for table salt when the sodium delta exceeds 50 ppm", () => {
    const atThreshold = calculateAdditions(
      ZERO_PROFILE,
      { ...ZERO_PROFILE, sodium_ppm: 50 },
      10
    );
    expect(atThreshold.table_salt_g).toBe(0);

    const aboveThreshold = calculateAdditions(
      ZERO_PROFILE,
      { ...ZERO_PROFILE, sodium_ppm: 60 },
      10
    );
    expect(aboveThreshold.table_salt_g).toBe(
      Math.round((600 / SALT_CONTRIBUTIONS.table_salt.sodium) * 10) / 10
    );
  });

  it("never suggests chalk or magnesium chloride (the greedy pass has no branch for them)", () => {
    const target: WaterProfile = {
      calcium_ppm: 150,
      magnesium_ppm: 20,
      sodium_ppm: 80,
      sulfate_ppm: 250,
      chloride_ppm: 120,
      bicarbonate_ppm: 100,
    };
    const result = calculateAdditions(ZERO_PROFILE, target, 10);
    expect(result.chalk_g).toBe(0);
    expect(result.magnesium_chloride_g).toBe(0);
  });
});

describe("toWaterProfile", () => {
  it("coerces null and missing ppm columns to 0 while preserving real values", () => {
    expect(
      toWaterProfile({
        calcium_ppm: 50,
        magnesium_ppm: null,
        sodium_ppm: 0,
        sulfate_ppm: 120.5,
      })
    ).toEqual({
      calcium_ppm: 50,
      magnesium_ppm: 0,
      sodium_ppm: 0,
      sulfate_ppm: 120.5,
      chloride_ppm: 0,
      bicarbonate_ppm: 0,
    });
  });

  it("maps an all-null row to the zero profile", () => {
    expect(
      toWaterProfile({
        calcium_ppm: null,
        magnesium_ppm: null,
        sodium_ppm: null,
        sulfate_ppm: null,
        chloride_ppm: null,
        bicarbonate_ppm: null,
      })
    ).toEqual(ZERO_PROFILE);
  });
});

describe("mapSaltAdditionsToItems", () => {
  const catalog = Object.entries(SALT_ADDITIVE_MAP).map(([field, name]) => ({
    id: `id-${field}`,
    name,
  }));

  it("emits one mash-timed gram item per non-zero salt, in SALT_ADDITIVE_MAP order", () => {
    const items = mapSaltAdditionsToItems(
      { ...ZERO_ADDITIONS, calcium_chloride_g: 3.9, gypsum_g: 6.8 },
      catalog
    );
    expect(items).toEqual([
      { additive_id: "id-gypsum_g", amount: 6.8, unit: "g", timing: "mash", target: "mash" },
      {
        additive_id: "id-calcium_chloride_g",
        amount: 3.9,
        unit: "g",
        timing: "mash",
        target: "mash",
      },
    ]);
  });

  it("skips zero and negative amounts", () => {
    expect(
      mapSaltAdditionsToItems(
        { ...ZERO_ADDITIONS, gypsum_g: 0, epsom_salt_g: -1 },
        catalog
      )
    ).toEqual([]);
  });

  it("matches catalog names case-insensitively", () => {
    const items = mapSaltAdditionsToItems({ ...ZERO_ADDITIONS, gypsum_g: 2 }, [
      { id: "lower", name: "gypsum" },
    ]);
    expect(items).toEqual([
      { additive_id: "lower", amount: 2, unit: "g", timing: "mash", target: "mash" },
    ]);
  });

  it("drops salts with no matching catalog entry rather than failing", () => {
    expect(
      mapSaltAdditionsToItems({ ...ZERO_ADDITIONS, chalk_g: 5 }, [
        { id: "id-gypsum_g", name: "Gypsum" },
      ])
    ).toEqual([]);
  });
});
