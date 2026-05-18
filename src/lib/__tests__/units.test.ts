import { describe, it, expect } from "vitest";
import {
  convertVolume,
  convertWeight,
  convertTemperature,
  convertGravity,
  convertRetailVolume,
  platoToSg,
  sgToPlato,
  formatVolume,
  formatWeight,
  formatTemperature,
  formatTemperatureRange,
  formatGravity,
  formatGravityFromSg,
  formatRetailVolume,
  parseVolumeInput,
  parseWeightInput,
  parseTemperatureInput,
  parseGravityInput,
  toDisplayValue,
  toCanonicalValue,
  getUnitOptions,
  getUnitLabel,
  getNextUnit,
} from "\@/domain/units";

// =============================================================================
// Volume Conversions
// =============================================================================

describe("Volume Conversions", () => {
  it("converts BBL to gallons", () => {
    expect(convertVolume(1, "bbl", "gal")).toBe(31);
  });

  it("converts gallons to BBL", () => {
    expect(convertVolume(31, "gal", "bbl")).toBeCloseTo(1, 5);
  });

  it("converts BBL to liters", () => {
    expect(convertVolume(1, "bbl", "l")).toBeCloseTo(117.348, 2);
  });

  it("converts liters to BBL", () => {
    expect(convertVolume(117.348, "l", "bbl")).toBeCloseTo(1, 3);
  });

  it("converts BBL to hectoliters", () => {
    expect(convertVolume(1, "bbl", "hl")).toBeCloseTo(1.17348, 4);
  });

  it("converts gallons to liters", () => {
    // 1 gal = 1/31 BBL, then 1/31 * 117.348 L
    const result = convertVolume(1, "gal", "l");
    expect(result).toBeCloseTo(117.348 / 31, 2);
  });

  it("returns same value for same-unit conversion", () => {
    expect(convertVolume(42, "bbl", "bbl")).toBe(42);
    expect(convertVolume(5, "gal", "gal")).toBe(5);
  });

  describe("round-trip accuracy", () => {
    it("BBL -> gal -> BBL", () => {
      const original = 7.5;
      const gal = convertVolume(original, "bbl", "gal");
      const back = convertVolume(gal, "gal", "bbl");
      expect(back).toBeCloseTo(original, 10);
    });

    it("BBL -> L -> BBL", () => {
      const original = 3.2;
      const liters = convertVolume(original, "bbl", "l");
      const back = convertVolume(liters, "l", "bbl");
      expect(back).toBeCloseTo(original, 10);
    });

    it("gal -> hl -> gal", () => {
      const original = 15.5;
      const hl = convertVolume(original, "gal", "hl");
      const back = convertVolume(hl, "hl", "gal");
      expect(back).toBeCloseTo(original, 8);
    });
  });
});

// =============================================================================
// Retail Volume Conversions
// =============================================================================

describe("Retail Volume Conversions", () => {
  it("converts oz to ml", () => {
    expect(convertRetailVolume(1, "oz", "ml")).toBeCloseTo(29.5735, 2);
  });

  it("converts ml to oz", () => {
    expect(convertRetailVolume(29.5735, "ml", "oz")).toBeCloseTo(1, 3);
  });

  it("returns same value for same-unit conversion", () => {
    expect(convertRetailVolume(12, "oz", "oz")).toBe(12);
  });

  it("round-trip oz -> ml -> oz", () => {
    const original = 16;
    const ml = convertRetailVolume(original, "oz", "ml");
    const back = convertRetailVolume(ml, "ml", "oz");
    expect(back).toBeCloseTo(original, 8);
  });
});

// =============================================================================
// Weight Conversions
// =============================================================================

describe("Weight Conversions", () => {
  it("converts lbs to kg", () => {
    expect(convertWeight(1, "lbs", "kg")).toBeCloseTo(0.453592, 4);
  });

  it("converts kg to lbs", () => {
    expect(convertWeight(1, "kg", "lbs")).toBeCloseTo(2.20462, 3);
  });

  it("returns same value for same-unit conversion", () => {
    expect(convertWeight(10, "lbs", "lbs")).toBe(10);
  });

  describe("round-trip accuracy", () => {
    it("lbs -> kg -> lbs", () => {
      const original = 55;
      const kg = convertWeight(original, "lbs", "kg");
      const back = convertWeight(kg, "kg", "lbs");
      expect(back).toBeCloseTo(original, 8);
    });
  });
});

// =============================================================================
// Temperature Conversions
// =============================================================================

describe("Temperature Conversions", () => {
  it("converts freezing point F to C", () => {
    expect(convertTemperature(32, "f", "c")).toBeCloseTo(0, 5);
  });

  it("converts boiling point F to C", () => {
    expect(convertTemperature(212, "f", "c")).toBeCloseTo(100, 5);
  });

  it("converts 0 C to F", () => {
    expect(convertTemperature(0, "c", "f")).toBeCloseTo(32, 5);
  });

  it("converts 100 C to F", () => {
    expect(convertTemperature(100, "c", "f")).toBeCloseTo(212, 5);
  });

  it("converts typical fermentation temp 68F to 20C", () => {
    expect(convertTemperature(68, "f", "c")).toBeCloseTo(20, 5);
  });

  it("returns same value for same-unit conversion", () => {
    expect(convertTemperature(72, "f", "f")).toBe(72);
    expect(convertTemperature(22, "c", "c")).toBe(22);
  });

  describe("round-trip accuracy", () => {
    it("F -> C -> F", () => {
      const original = 152;
      const c = convertTemperature(original, "f", "c");
      const back = convertTemperature(c, "c", "f");
      expect(back).toBeCloseTo(original, 8);
    });

    it("C -> F -> C", () => {
      const original = 66.7;
      const f = convertTemperature(original, "c", "f");
      const back = convertTemperature(f, "f", "c");
      expect(back).toBeCloseTo(original, 8);
    });
  });
});

// =============================================================================
// Gravity Conversions (Plato <-> SG)
// =============================================================================

describe("Gravity Conversions", () => {
  describe("platoToSg", () => {
    it("converts 0 Plato to ~1.000 SG", () => {
      expect(platoToSg(0)).toBeCloseTo(1.0, 3);
    });

    it("converts 12 Plato to ~1.048 SG", () => {
      expect(platoToSg(12)).toBeCloseTo(1.048, 2);
    });

    it("converts 20 Plato to approximately 1.083 SG", () => {
      const sg = platoToSg(20);
      expect(sg).toBeGreaterThan(1.08);
      expect(sg).toBeLessThan(1.09);
    });
  });

  describe("sgToPlato", () => {
    it("converts SG 1.000 to ~0 Plato", () => {
      expect(sgToPlato(1.0)).toBeCloseTo(0, 0);
    });

    it("converts SG 1.048 to ~12 Plato", () => {
      expect(sgToPlato(1.048)).toBeCloseTo(12, 0);
    });

    it("converts SG 1.060 to reasonable Plato", () => {
      const plato = sgToPlato(1.06);
      expect(plato).toBeGreaterThan(14);
      expect(plato).toBeLessThan(16);
    });
  });

  describe("convertGravity", () => {
    it("converts Plato to SG via convertGravity", () => {
      const sg = convertGravity(12, "plato", "sg");
      expect(sg).toBeCloseTo(1.048, 2);
    });

    it("converts SG to Plato via convertGravity", () => {
      const plato = convertGravity(1.048, "sg", "plato");
      expect(plato).toBeCloseTo(12, 0);
    });

    it("returns same value for same-unit conversion", () => {
      expect(convertGravity(12, "plato", "plato")).toBe(12);
      expect(convertGravity(1.05, "sg", "sg")).toBe(1.05);
    });
  });

  describe("round-trip accuracy", () => {
    it("Plato -> SG -> Plato (approximate)", () => {
      // Note: the Plato<->SG formulas are polynomial approximations
      // so round-trip won't be exact, but should be close
      const original = 15;
      const sg = platoToSg(original);
      const back = sgToPlato(sg);
      expect(back).toBeCloseTo(original, 0);
    });
  });
});

// =============================================================================
// Format Functions
// =============================================================================

describe("Format Functions", () => {
  describe("formatVolume", () => {
    it("formats BBL to gallons with label", () => {
      expect(formatVolume(1, "gal")).toBe("31.00 gal");
    });

    it("returns dash for null input", () => {
      expect(formatVolume(null, "gal")).toBe("\u2014");
    });

    it("returns dash for undefined input", () => {
      expect(formatVolume(undefined, "bbl")).toBe("\u2014");
    });

    it("respects decimal places", () => {
      expect(formatVolume(1, "gal", 0)).toBe("31 gal");
      expect(formatVolume(1, "gal", 1)).toBe("31.0 gal");
    });
  });

  describe("formatWeight", () => {
    it("formats lbs to kg with label", () => {
      const result = formatWeight(1, "kg");
      expect(result).toContain("kg");
      expect(parseFloat(result)).toBeCloseTo(0.45, 1);
    });

    it("returns dash for null", () => {
      expect(formatWeight(null, "lbs")).toBe("\u2014");
    });
  });

  describe("formatTemperature", () => {
    it("formats F to C with label", () => {
      const result = formatTemperature(212, "c");
      expect(result).toBe("100.0\u00B0C");
    });

    it("returns dash for null", () => {
      expect(formatTemperature(null, "f")).toBe("\u2014");
    });
  });

  describe("formatGravity", () => {
    it("formats Plato with degree symbol", () => {
      const result = formatGravity(12, "plato");
      expect(result).toBe("12.0\u00B0P");
    });

    it("formats Plato as SG", () => {
      const result = formatGravity(12, "sg");
      expect(result).toContain("1.04");
    });

    it("returns dash for null", () => {
      expect(formatGravity(null, "plato")).toBe("\u2014");
    });
  });

  describe("formatGravityFromSg", () => {
    it("returns dash for null", () => {
      expect(formatGravityFromSg(null, "sg")).toBe("\u2014");
    });

    it("returns dash for undefined", () => {
      expect(formatGravityFromSg(undefined, "sg")).toBe("\u2014");
    });

    it("formats SG value when displayUnit is sg", () => {
      expect(formatGravityFromSg(1.048, "sg")).toBe("1.048");
    });

    it("formats as Plato when displayUnit is plato", () => {
      const result = formatGravityFromSg(1.048, "plato");
      expect(result).toContain("°P");
      expect(parseFloat(result)).toBeCloseTo(12, 0);
    });

    it("respects custom decimal places in sg mode", () => {
      expect(formatGravityFromSg(1.048, "sg", 2)).toBe("1.05");
    });

    it("respects custom decimal places in plato mode", () => {
      const result = formatGravityFromSg(1.048, "plato", 0);
      expect(result).toMatch(/^\d+°P$/);
    });
  });

  describe("formatRetailVolume", () => {
    it("formats oz to ml", () => {
      const result = formatRetailVolume(1, "ml");
      expect(result).toContain("mL");
    });

    it("returns dash for null", () => {
      expect(formatRetailVolume(null, "oz")).toBe("\u2014");
    });
  });

  describe("formatTemperatureRange", () => {
    it("formats a range in \u00b0F", () => {
      expect(formatTemperatureRange(60, 72, "f")).toBe("60-72\u00b0F");
    });

    it("formats a range converted to \u00b0C", () => {
      expect(formatTemperatureRange(32, 212, "c")).toBe("0-100\u00b0C");
    });

    it("returns dash when lowF is NaN", () => {
      expect(formatTemperatureRange(NaN, 72, "f")).toBe("\u2014");
    });

    it("returns dash when highF is NaN", () => {
      expect(formatTemperatureRange(60, NaN, "f")).toBe("\u2014");
    });

    it("returns dash for Infinity", () => {
      expect(formatTemperatureRange(Infinity, 72, "f")).toBe("\u2014");
    });
  });

  describe("formatGravityFromSg", () => {
    it("formats SG in sg display unit", () => {
      expect(formatGravityFromSg(1.048, "sg")).toBe("1.048");
    });

    it("formats SG converted to Plato", () => {
      const result = formatGravityFromSg(1.048, "plato");
      expect(result).toContain("\u00b0P");
    });

    it("returns dash for null", () => {
      expect(formatGravityFromSg(null, "sg")).toBe("\u2014");
    });
  });

  describe("non-finite input guards", () => {
    it("formatVolume returns dash for NaN and Infinity", () => {
      expect(formatVolume(NaN, "bbl")).toBe("\u2014");
      expect(formatVolume(Infinity, "bbl")).toBe("\u2014");
      expect(formatVolume(-Infinity, "gal")).toBe("\u2014");
    });

    it("formatWeight returns dash for NaN and Infinity", () => {
      expect(formatWeight(NaN, "lbs")).toBe("\u2014");
      expect(formatWeight(Infinity, "lbs")).toBe("\u2014");
    });

    it("formatTemperature returns dash for NaN and Infinity", () => {
      expect(formatTemperature(NaN, "f")).toBe("\u2014");
      expect(formatTemperature(Infinity, "c")).toBe("\u2014");
    });

    it("formatGravity returns dash for NaN and Infinity", () => {
      expect(formatGravity(NaN, "plato")).toBe("\u2014");
      expect(formatGravity(Infinity, "sg")).toBe("\u2014");
    });

    it("formatRetailVolume returns dash for NaN and Infinity", () => {
      expect(formatRetailVolume(NaN, "oz")).toBe("\u2014");
      expect(formatRetailVolume(Infinity, "ml")).toBe("\u2014");
    });

    it("formatGravityFromSg returns dash for NaN and Infinity", () => {
      expect(formatGravityFromSg(NaN, "sg")).toBe("\u2014");
      expect(formatGravityFromSg(Infinity, "plato")).toBe("\u2014");
    });

    it("formatTemperatureRange returns dash for NaN and Infinity", () => {
      expect(formatTemperatureRange(NaN, 72, "f")).toBe("\u2014");
      expect(formatTemperatureRange(60, Infinity, "f")).toBe("\u2014");
    });
  });
});

// =============================================================================
// Parse Input Functions (to canonical)
// =============================================================================

describe("Parse Input Functions", () => {
  it("parseVolumeInput converts gal to BBL", () => {
    expect(parseVolumeInput(31, "gal")).toBeCloseTo(1, 5);
  });

  it("parseVolumeInput passes BBL through", () => {
    expect(parseVolumeInput(5, "bbl")).toBe(5);
  });

  it("parseWeightInput converts kg to lbs", () => {
    expect(parseWeightInput(1, "kg")).toBeCloseTo(2.20462, 3);
  });

  it("parseTemperatureInput converts C to F", () => {
    expect(parseTemperatureInput(100, "c")).toBeCloseTo(212, 5);
  });

  it("parseGravityInput converts SG to Plato", () => {
    expect(parseGravityInput(1.048, "sg")).toBeCloseTo(12, 0);
  });
});

// =============================================================================
// Generic toDisplayValue / toCanonicalValue
// =============================================================================

describe("Generic conversion functions", () => {
  it("toDisplayValue converts volume from canonical BBL", () => {
    expect(toDisplayValue(1, "volume", "gal")).toBe(31);
  });

  it("toDisplayValue converts weight from canonical lbs", () => {
    expect(toDisplayValue(1, "weight", "kg")).toBeCloseTo(0.453592, 4);
  });

  it("toDisplayValue converts temperature from canonical F", () => {
    expect(toDisplayValue(32, "temperature", "c")).toBeCloseTo(0, 5);
  });

  it("toDisplayValue converts gravity from canonical Plato", () => {
    expect(toDisplayValue(12, "gravity", "sg")).toBeCloseTo(1.048, 2);
  });

  it("toDisplayValue converts retail_volume from canonical oz", () => {
    expect(toDisplayValue(1, "retail_volume", "ml")).toBeCloseTo(29.5735, 2);
  });

  it("toCanonicalValue converts volume to BBL", () => {
    expect(toCanonicalValue(31, "volume", "gal")).toBeCloseTo(1, 5);
  });

  it("toCanonicalValue converts weight to lbs", () => {
    expect(toCanonicalValue(1, "weight", "kg")).toBeCloseTo(2.20462, 3);
  });

  it("round-trip through toDisplayValue and toCanonicalValue", () => {
    const original = 5;
    const displayed = toDisplayValue(original, "volume", "gal");
    const canonical = toCanonicalValue(displayed, "volume", "gal");
    expect(canonical).toBeCloseTo(original, 8);
  });
});

// =============================================================================
// Utility Functions
// =============================================================================

describe("Utility Functions", () => {
  describe("getUnitOptions", () => {
    it("returns volume unit options", () => {
      expect(getUnitOptions("volume")).toEqual(["bbl", "gal", "l", "hl"]);
    });

    it("returns weight unit options", () => {
      expect(getUnitOptions("weight")).toEqual(["lbs", "kg"]);
    });

    it("returns temperature unit options", () => {
      expect(getUnitOptions("temperature")).toEqual(["f", "c"]);
    });

    it("returns gravity unit options", () => {
      expect(getUnitOptions("gravity")).toEqual(["plato", "sg"]);
    });

    it("returns retail_volume unit options", () => {
      expect(getUnitOptions("retail_volume")).toEqual(["oz", "ml"]);
    });
  });

  describe("getUnitLabel", () => {
    it("returns correct labels", () => {
      expect(getUnitLabel("bbl")).toBe("BBL");
      expect(getUnitLabel("gal")).toBe("gal");
      expect(getUnitLabel("f")).toBe("\u00B0F");
      expect(getUnitLabel("c")).toBe("\u00B0C");
      expect(getUnitLabel("plato")).toBe("\u00B0P");
      expect(getUnitLabel("sg")).toBe("SG");
    });

    it("returns raw string for unknown unit", () => {
      expect(getUnitLabel("unknown")).toBe("unknown");
    });
  });

  describe("getNextUnit", () => {
    it("cycles volume units", () => {
      expect(getNextUnit("volume", "bbl")).toBe("gal");
      expect(getNextUnit("volume", "gal")).toBe("l");
      expect(getNextUnit("volume", "l")).toBe("hl");
      expect(getNextUnit("volume", "hl")).toBe("bbl");
    });

    it("cycles weight units", () => {
      expect(getNextUnit("weight", "lbs")).toBe("kg");
      expect(getNextUnit("weight", "kg")).toBe("lbs");
    });

    it("cycles temperature units", () => {
      expect(getNextUnit("temperature", "f")).toBe("c");
      expect(getNextUnit("temperature", "c")).toBe("f");
    });

    it("cycles gravity units", () => {
      expect(getNextUnit("gravity", "plato")).toBe("sg");
      expect(getNextUnit("gravity", "sg")).toBe("plato");
    });

    it("cycles retail_volume units", () => {
      expect(getNextUnit("retail_volume", "oz")).toBe("ml");
      expect(getNextUnit("retail_volume", "ml")).toBe("oz");
    });
  });
});
