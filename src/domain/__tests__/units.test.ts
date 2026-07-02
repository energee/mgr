// @vitest-environment node
/**
 * Tests for the canonical unit conversion/formatting library
 * (src/domain/units.ts) — volume, retail volume, weight, temperature,
 * and gravity conversions between canonical storage units and display
 * units, plus alias-tolerant ingredient weight conversion.
 */

import { describe, it, expect } from "vitest";
import {
  convertVolume,
  formatVolume,
  parseVolumeInput,
  volumeToDisplay,
  convertRetailVolume,
  formatRetailVolume,
  parseRetailVolumeInput,
  convertWeight,
  formatWeight,
  parseWeightInput,
  weightToDisplay,
  convertIngredientQuantity,
  convertTemperature,
  formatTemperature,
  formatTemperatureRange,
  platoToSg,
  sgToPlato,
  convertGravity,
  formatGravity,
  formatGravityFromSg,
  parseGravityInput,
} from "@/domain/units";

describe("Volume (bbl/gal/l/hl)", () => {
  it("converts using the canonical VOLUME_CONVERSIONS ratios and round-trips", () => {
    expect(convertVolume(1, "bbl", "gal")).toBe(31);
    expect(convertVolume(1, "bbl", "l")).toBe(117.348);
    expect(convertVolume(1, "bbl", "hl")).toBe(1.17348);
    // round trip back to bbl
    expect(convertVolume(31, "gal", "bbl")).toBe(1);
    expect(convertVolume(117.348, "l", "bbl")).toBe(1);
  });

  it("formats, parses input, and handles null", () => {
    expect(formatVolume(2, "gal", 2)).toBe("62.00 gal");
    expect(formatVolume(null, "gal")).toBe("—");
    expect(formatVolume(undefined, "bbl")).toBe("—");
    expect(parseVolumeInput(31, "gal")).toBe(1);
    expect(volumeToDisplay(1, "gal")).toBe(31);
  });
});

describe("Retail volume (oz/ml)", () => {
  it("converts using RETAIL_VOLUME_CONVERSIONS and round-trips", () => {
    expect(convertRetailVolume(1, "oz", "ml")).toBeCloseTo(29.5735, 4);
    expect(convertRetailVolume(29.5735, "ml", "oz")).toBeCloseTo(1, 10);
  });

  it("formats and handles null/undefined", () => {
    expect(formatRetailVolume(1, "ml", 1)).toBe("29.6 mL");
    expect(formatRetailVolume(null, "ml")).toBe("—");
    expect(formatRetailVolume(undefined, "oz")).toBe("—");
    expect(parseRetailVolumeInput(29.5735, "ml")).toBeCloseTo(1, 10);
  });
});

describe("Weight (lbs/kg)", () => {
  it("converts using WEIGHT_CONVERSIONS and round-trips", () => {
    expect(convertWeight(1, "lbs", "kg")).toBe(0.453592);
    expect(convertWeight(0.453592, "kg", "lbs")).toBeCloseTo(1, 10);
    expect(weightToDisplay(1, "kg")).toBe(0.453592);
  });

  it("formats and handles null", () => {
    expect(formatWeight(2, "kg", 2)).toBe("0.91 kg");
    expect(formatWeight(null, "kg")).toBe("—");
    expect(parseWeightInput(0.453592, "kg")).toBeCloseTo(1, 10);
  });

  it("convertIngredientQuantity handles free-text weight aliases and unknown units", () => {
    expect(convertIngredientQuantity(16, "oz", "lb")).toBeCloseTo(1, 10);
    expect(convertIngredientQuantity(1, "kg", "g")).toBeCloseTo(1000, 6);
    expect(convertIngredientQuantity(5, "lb", "lb")).toBe(5);
    // unrecognized unit -> null, caller falls back to 1:1
    expect(convertIngredientQuantity(5, "sack", "lb")).toBeNull();
  });
});

describe("Temperature (f/c)", () => {
  it("converts known reference points", () => {
    expect(convertTemperature(32, "f", "c")).toBe(0);
    expect(convertTemperature(212, "f", "c")).toBe(100);
    expect(convertTemperature(100, "c", "f")).toBe(212);
  });

  it("formats a single value, a range, and handles null", () => {
    expect(formatTemperature(32, "c", 1)).toBe("0.0°C");
    expect(formatTemperature(null, "c")).toBe("—");
    expect(formatTemperatureRange(32, 212, "c")).toBe("0-100°C");
  });
});

describe("Gravity (plato/sg)", () => {
  it("platoToSg/sgToPlato compute values from the ASBC formula constants", () => {
    expect(platoToSg(0)).toBe(1);
    expect(platoToSg(10)).toBeCloseTo(1.040031, 6);
    expect(sgToPlato(1.05)).toBeCloseTo(12.387647, 6);
    // sgToPlato is an approximation of platoToSg's inverse, not exact,
    // but should recover the original value within a small tolerance.
    expect(sgToPlato(platoToSg(10))).toBeCloseTo(10, 2);
  });

  it("formats plato/sg display values and handles null", () => {
    expect(formatGravity(10, "plato")).toBe("10.0°P");
    expect(formatGravity(10, "sg")).toBe("1.040");
    expect(formatGravity(null, "plato")).toBe("—");
    expect(formatGravityFromSg(1.05, "sg")).toBe("1.050");
    expect(formatGravityFromSg(1.05, "plato")).toBe("12.4°P");
    expect(formatGravityFromSg(undefined, "sg")).toBe("—");
  });

  it("parseGravityInput normalizes plato/sg input to canonical plato", () => {
    expect(parseGravityInput(10, "plato")).toBe(10);
    expect(parseGravityInput(1.05, "sg")).toBeCloseTo(12.387647, 6);
    expect(convertGravity(10, "plato", "sg")).toBeCloseTo(1.040031, 6);
  });
});
