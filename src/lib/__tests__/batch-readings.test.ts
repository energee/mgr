import { describe, it, expect } from "vitest";
import {
  validateReading,
  convertGravity,
  convertTemperature,
  formatReadingValue,
  getUnitLabel,
  READING_TYPES,
} from "../batch-readings";

describe("validateReading", () => {
  describe("gravity", () => {
    it("accepts valid plato value", () => {
      expect(validateReading("gravity", 12.5)).toEqual({ valid: true });
    });

    it("rejects value below min", () => {
      const result = validateReading("gravity", -1);
      expect(result.valid).toBe(false);
    });

    it("rejects value above max", () => {
      const result = validateReading("gravity", 50);
      expect(result.valid).toBe(false);
    });

    it("warns when outside typical range", () => {
      const result = validateReading("gravity", 30);
      expect(result.valid).toBe(true);
      expect(result.warning).toBeDefined();
    });
  });

  describe("temperature", () => {
    it("accepts valid fermentation temp", () => {
      expect(validateReading("temperature", 68)).toEqual({ valid: true });
    });

    it("warns for high temp", () => {
      const result = validateReading("temperature", 95);
      expect(result.valid).toBe(true);
      expect(result.warning).toContain("outside typical range");
    });
  });

  describe("ph", () => {
    it("accepts valid mash pH", () => {
      expect(validateReading("ph", 4.5)).toEqual({ valid: true });
    });

    it("rejects negative pH", () => {
      expect(validateReading("ph", -1).valid).toBe(false);
    });

    it("rejects pH above 14", () => {
      expect(validateReading("ph", 15).valid).toBe(false);
    });
  });

  describe("diacetyl (option-based)", () => {
    it("accepts valid option", () => {
      expect(validateReading("diacetyl", "absent")).toEqual({ valid: true });
    });

    it("rejects invalid option", () => {
      const result = validateReading("diacetyl", "high");
      expect(result.valid).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("handles string numeric values", () => {
      expect(validateReading("gravity", "12.5").valid).toBe(true);
    });

    it("rejects NaN string", () => {
      expect(validateReading("gravity", "abc").valid).toBe(false);
    });

    it("handles unknown reading type", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(validateReading("unknown" as any, 5).valid).toBe(false);
    });
  });
});

describe("convertGravity", () => {
  it("converts SG to Plato", () => {
    const plato = convertGravity(1.050, "sg", "plato");
    expect(plato).toBeCloseTo(12.39, 0);
  });

  it("converts Plato to SG", () => {
    const sg = convertGravity(12.39, "plato", "sg");
    expect(sg).toBeCloseTo(1.050, 2);
  });

  it("returns same value when units match", () => {
    expect(convertGravity(1.050, "sg", "sg")).toBe(1.050);
  });
});

describe("convertTemperature", () => {
  it("converts F to C", () => {
    expect(convertTemperature(68, "f", "c")).toBeCloseTo(20, 1);
  });

  it("converts C to F", () => {
    expect(convertTemperature(20, "c", "f")).toBeCloseTo(68, 1);
  });

  it("returns same value when units match", () => {
    expect(convertTemperature(68, "f", "f")).toBe(68);
  });
});

describe("formatReadingValue", () => {
  it("formats gravity in SG with 3 decimals", () => {
    expect(formatReadingValue("gravity", 1.050, "sg")).toBe("1.050");
  });

  it("formats gravity in Plato with 1 decimal", () => {
    expect(formatReadingValue("gravity", 12.5, "plato")).toBe("12.5");
  });

  it("formats temperature with degree symbol", () => {
    expect(formatReadingValue("temperature", 68.0, "f")).toBe("68.0°F");
  });

  it("formats pH with 2 decimals", () => {
    expect(formatReadingValue("ph", 5.2, "ph")).toBe("5.20");
  });

  it("formats diacetyl option with capitalization", () => {
    expect(formatReadingValue("diacetyl", "absent", "status")).toBe("Absent");
  });

  it("formats clarity on scale", () => {
    expect(formatReadingValue("clarity", 3, "scale")).toBe("3/5");
  });

  it("formats clarity in NTU", () => {
    expect(formatReadingValue("clarity", 4.5, "ntu")).toBe("4.5 NTU");
  });
});

describe("getUnitLabel", () => {
  it("returns °F for temperature fahrenheit", () => {
    expect(getUnitLabel("temperature", "f")).toBe("°F");
  });

  it("returns °C for temperature celsius", () => {
    expect(getUnitLabel("temperature", "c")).toBe("°C");
  });

  it("returns SG for gravity sg", () => {
    expect(getUnitLabel("gravity", "sg")).toBe("SG");
  });

  it("returns °P for gravity plato", () => {
    expect(getUnitLabel("gravity", "plato")).toBe("°P");
  });

  it("returns empty for diacetyl", () => {
    expect(getUnitLabel("diacetyl", "status")).toBe("");
  });
});
