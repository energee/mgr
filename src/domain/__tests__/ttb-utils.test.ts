/**
 * Tests for TTB Form 5130.9 pure helpers (src/domain/ttb-utils.ts):
 * barrel/gallon conversion, compliance-safe decimal formatting, tax class
 * label lookup, and report-period year options.
 */

import { describe, it, expect } from "vitest";
import {
  bblToGallons,
  gallonsToBbl,
  formatTtbBbl,
  getTaxClassLabel,
  getYearOptions,
  GALLONS_PER_BARREL,
  MONTHS,
} from "@/domain/ttb-utils";

describe("GALLONS_PER_BARREL", () => {
  it("is the TTB standard of 31 US gallons per barrel", () => {
    expect(GALLONS_PER_BARREL).toBe(31);
  });
});

describe("bblToGallons / gallonsToBbl", () => {
  it("converts barrels to gallons using the 31 gal/bbl standard", () => {
    expect(bblToGallons(1)).toBe(31);
    expect(bblToGallons(2)).toBe(62);
  });

  it("converts gallons to barrels using the 31 gal/bbl standard", () => {
    expect(gallonsToBbl(31)).toBe(1);
    expect(gallonsToBbl(62)).toBe(2);
  });

  it("round-trips bbl -> gal -> bbl", () => {
    expect(gallonsToBbl(bblToGallons(4.5))).toBeCloseTo(4.5, 10);
  });
});

describe("formatTtbBbl", () => {
  it("formats null/undefined as '0.00', not '--' (TTB forms must show zero, not blank)", () => {
    expect(formatTtbBbl(null)).toBe("0.00");
    expect(formatTtbBbl(undefined)).toBe("0.00");
  });

  it("formats zero as '0.00'", () => {
    expect(formatTtbBbl(0)).toBe("0.00");
  });

  it("formats decimals to 2 places", () => {
    expect(formatTtbBbl(12.345)).toBe("12.35");
    expect(formatTtbBbl(7)).toBe("7.00");
  });
});

describe("getTaxClassLabel", () => {
  it("maps known tax class codes to their labels", () => {
    expect(getTaxClassLabel("cellar")).toBe("Cellar (In-Process)");
    expect(getTaxClassLabel("keg")).toBe("Kegs");
    expect(getTaxClassLabel("bottled")).toBe("Canned/Bottled");
  });

  it("passes unknown codes through unchanged", () => {
    expect(getTaxClassLabel("unknown_class")).toBe("unknown_class");
    expect(getTaxClassLabel("")).toBe("");
  });
});

describe("getYearOptions", () => {
  it("returns the given year and 3 years back (4 total, descending)", () => {
    expect(getYearOptions(2024)).toEqual([2024, 2023, 2022, 2021]);
  });

  it("defaults to the current year when no argument is given", () => {
    const currentYear = new Date().getFullYear();
    expect(getYearOptions()).toEqual([
      currentYear,
      currentYear - 1,
      currentYear - 2,
      currentYear - 3,
    ]);
  });
});

describe("MONTHS", () => {
  it("has 12 full month names in calendar order", () => {
    expect(MONTHS).toHaveLength(12);
    expect(MONTHS[0]).toBe("January");
    expect(MONTHS[11]).toBe("December");
  });
});
