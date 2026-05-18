/**
 * TTB Report Calculation Tests
 *
 * Unit tests for TTB Form 5130.9 data transformation, formatting, and
 * export logic used in the brewery's federal tax compliance reporting.
 */

import { describe, it, expect } from "vitest";
import {
  GALLONS_PER_BARREL,
  MONTHS,
  bblToGallons,
  gallonsToBbl,
  formatTtbBbl,
  getTaxClassLabel,
  getYearOptions,
  calculateTotals,
  validateRowBalance,
  validateEndingInventory,
  sumBatchVolumes,
  EMPTY_TOTALS,
  type TTBReportRow,
} from "@/domain/ttb-utils";
import { toCSV } from "@/lib/report-export";

// =============================================================================
// Test Fixtures
// =============================================================================

/** Factory for creating a TTB report row with sensible defaults. */
function makeRow(overrides: Partial<TTBReportRow> = {}): TTBReportRow {
  return {
    report_year: 2026,
    report_month: 3,
    report_period: "2026-03",
    ttb_tax_class: "keg",
    beginning_inventory_bbl: 0,
    beer_produced_bbl: 0,
    beer_received_bbl: 0,
    total_available_bbl: 0,
    taxpaid_domestic_bbl: 0,
    taxpaid_export_bbl: 0,
    tax_free_samples_bbl: 0,
    losses_bbl: 0,
    destroyed_bbl: 0,
    adjustments_bbl: 0,
    total_removals_bbl: 0,
    ending_inventory_bbl: 0,
    in_process_beginning_bbl: 0,
    in_process_ending_bbl: 0,
    ...overrides,
  };
}

// =============================================================================
// Barrel-to-Gallon Conversions
// =============================================================================

describe("Barrel/Gallon Conversions", () => {
  it("uses the TTB standard of 31 gallons per barrel", () => {
    expect(GALLONS_PER_BARREL).toBe(31);
  });

  it("converts BBL to gallons correctly", () => {
    expect(bblToGallons(1)).toBe(31);
    expect(bblToGallons(0)).toBe(0);
    expect(bblToGallons(10)).toBe(310);
    expect(bblToGallons(0.5)).toBeCloseTo(15.5);
  });

  it("converts gallons to BBL correctly", () => {
    expect(gallonsToBbl(31)).toBe(1);
    expect(gallonsToBbl(0)).toBe(0);
    expect(gallonsToBbl(310)).toBe(10);
    expect(gallonsToBbl(15.5)).toBeCloseTo(0.5);
  });

  it("round-trips BBL -> gallons -> BBL", () => {
    const original = 7.25;
    expect(gallonsToBbl(bblToGallons(original))).toBeCloseTo(original);
  });
});

// =============================================================================
// TTB BBL Formatting
// =============================================================================

describe("formatTtbBbl", () => {
  it("formats a number to two decimal places", () => {
    expect(formatTtbBbl(10)).toBe("10.00");
    expect(formatTtbBbl(3.5)).toBe("3.50");
    expect(formatTtbBbl(0.123)).toBe("0.12");
  });

  it("formats null as '0.00' (TTB compliance — no blanks on regulatory forms)", () => {
    expect(formatTtbBbl(null)).toBe("0.00");
  });

  it("formats undefined as '0.00'", () => {
    expect(formatTtbBbl(undefined)).toBe("0.00");
  });

  it("formats zero as '0.00'", () => {
    expect(formatTtbBbl(0)).toBe("0.00");
  });
});

// =============================================================================
// Tax Class Labels
// =============================================================================

describe("getTaxClassLabel", () => {
  it("maps 'cellar' to 'Cellar (In-Process)'", () => {
    expect(getTaxClassLabel("cellar")).toBe("Cellar (In-Process)");
  });

  it("maps 'keg' to 'Kegs'", () => {
    expect(getTaxClassLabel("keg")).toBe("Kegs");
  });

  it("maps 'bottled' to 'Canned/Bottled'", () => {
    expect(getTaxClassLabel("bottled")).toBe("Canned/Bottled");
  });

  it("passes through unknown tax class codes unchanged", () => {
    expect(getTaxClassLabel("other")).toBe("other");
    expect(getTaxClassLabel("draft")).toBe("draft");
  });
});

// =============================================================================
// Year Options
// =============================================================================

describe("getYearOptions", () => {
  it("returns 4 years: current and 3 prior", () => {
    const options = getYearOptions(2026);
    expect(options).toEqual([2026, 2025, 2024, 2023]);
  });

  it("is sorted descending (most recent first)", () => {
    const options = getYearOptions(2030);
    expect(options[0]).toBeGreaterThan(options[options.length - 1]);
  });
});

// =============================================================================
// MONTHS constant
// =============================================================================

describe("MONTHS", () => {
  it("has exactly 12 entries", () => {
    expect(MONTHS).toHaveLength(12);
  });

  it("starts with January and ends with December", () => {
    expect(MONTHS[0]).toBe("January");
    expect(MONTHS[11]).toBe("December");
  });
});

// =============================================================================
// Totals Calculation
// =============================================================================

describe("calculateTotals", () => {
  it("returns EMPTY_TOTALS for an empty array", () => {
    expect(calculateTotals([])).toEqual(EMPTY_TOTALS);
  });

  it("sums a single row correctly", () => {
    const row = makeRow({
      beginning_inventory_bbl: 10,
      beer_produced_bbl: 20,
      total_available_bbl: 30,
      taxpaid_domestic_bbl: 5,
      taxpaid_export_bbl: 2,
      tax_free_samples_bbl: 1,
      losses_bbl: 0.5,
      destroyed_bbl: 0,
      total_removals_bbl: 8.5,
      ending_inventory_bbl: 21.5,
      in_process_ending_bbl: 3,
    });
    const totals = calculateTotals([row]);
    expect(totals.beginningInventory).toBe(10);
    expect(totals.beerProduced).toBe(20);
    expect(totals.totalAvailable).toBe(30);
    expect(totals.taxpaidDomestic).toBe(5);
    expect(totals.taxpaidExport).toBe(2);
    expect(totals.taxFreeSamples).toBe(1);
    expect(totals.losses).toBe(0.5);
    expect(totals.destroyed).toBe(0);
    expect(totals.totalRemovals).toBe(8.5);
    expect(totals.endingInventory).toBe(21.5);
    expect(totals.inProcessEnding).toBe(3);
  });

  it("sums multiple tax classes (keg + bottled + cellar)", () => {
    const rows = [
      makeRow({ ttb_tax_class: "keg", beer_produced_bbl: 15, ending_inventory_bbl: 10 }),
      makeRow({ ttb_tax_class: "bottled", beer_produced_bbl: 8, ending_inventory_bbl: 5 }),
      makeRow({ ttb_tax_class: "cellar", beer_produced_bbl: 3, ending_inventory_bbl: 2 }),
    ];
    const totals = calculateTotals(rows);
    expect(totals.beerProduced).toBe(26);
    expect(totals.endingInventory).toBe(17);
  });

  it("treats falsy numeric fields as zero (no NaN propagation)", () => {
    // Simulate a row where some fields might be 0 or missing
    const row = makeRow({
      beginning_inventory_bbl: 0,
      beer_produced_bbl: 0,
      total_available_bbl: 0,
    });
    const totals = calculateTotals([row]);
    expect(totals.beginningInventory).toBe(0);
    expect(totals.beerProduced).toBe(0);
    expect(Number.isNaN(totals.totalAvailable)).toBe(false);
  });
});

// =============================================================================
// Row Balance Validation
// =============================================================================

describe("validateRowBalance", () => {
  it("returns true when total_available equals beginning + produced + received", () => {
    const row = makeRow({
      beginning_inventory_bbl: 10,
      beer_produced_bbl: 20,
      beer_received_bbl: 5,
      total_available_bbl: 35,
    });
    expect(validateRowBalance(row)).toBe(true);
  });

  it("returns false when total_available is incorrect", () => {
    const row = makeRow({
      beginning_inventory_bbl: 10,
      beer_produced_bbl: 20,
      beer_received_bbl: 5,
      total_available_bbl: 100, // wrong
    });
    expect(validateRowBalance(row)).toBe(false);
  });

  it("tolerates small floating-point rounding (< 0.005)", () => {
    const row = makeRow({
      beginning_inventory_bbl: 1.001,
      beer_produced_bbl: 2.002,
      beer_received_bbl: 0,
      total_available_bbl: 3.003,
    });
    expect(validateRowBalance(row)).toBe(true);
  });
});

// =============================================================================
// Ending Inventory Validation
// =============================================================================

describe("validateEndingInventory", () => {
  it("returns true when ending = total_available - total_removals", () => {
    const row = makeRow({
      total_available_bbl: 50,
      total_removals_bbl: 30,
      ending_inventory_bbl: 20,
    });
    expect(validateEndingInventory(row)).toBe(true);
  });

  it("returns false when ending inventory is wrong", () => {
    const row = makeRow({
      total_available_bbl: 50,
      total_removals_bbl: 30,
      ending_inventory_bbl: 25, // should be 20
    });
    expect(validateEndingInventory(row)).toBe(false);
  });
});

// =============================================================================
// Batch Volume Summation
// =============================================================================

describe("sumBatchVolumes", () => {
  it("sums volumes from multiple batches", () => {
    const batches = [
      { volume_bbl: 7 },
      { volume_bbl: 3.5 },
      { volume_bbl: 10 },
    ];
    expect(sumBatchVolumes(batches)).toBeCloseTo(20.5);
  });

  it("treats null volumes as zero", () => {
    const batches = [
      { volume_bbl: 5 },
      { volume_bbl: null },
      { volume_bbl: 3 },
    ];
    expect(sumBatchVolumes(batches)).toBe(8);
  });

  it("returns 0 for empty array", () => {
    expect(sumBatchVolumes([])).toBe(0);
  });
});

// =============================================================================
// CSV Export (toCSV from report-export)
// =============================================================================

describe("toCSV", () => {
  it("generates header row from column definitions", () => {
    const rows = [{ a: "1", b: "2" }];
    const columns = [
      { key: "a", header: "Column A" },
      { key: "b", header: "Column B" },
    ];
    const csv = toCSV(rows, columns);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Column A,Column B");
  });

  it("auto-detects columns from first row when none specified", () => {
    const rows = [{ name: "IPA", volume: 10 }];
    const csv = toCSV(rows);
    expect(csv).toContain("name,volume");
  });

  it("returns empty string for empty array", () => {
    expect(toCSV([])).toBe("");
  });

  it("escapes fields containing commas", () => {
    const rows = [{ note: "hello, world" }];
    const csv = toCSV(rows);
    expect(csv).toContain('"hello, world"');
  });

  it("escapes fields containing double quotes", () => {
    const rows = [{ note: 'say "hi"' }];
    const csv = toCSV(rows);
    expect(csv).toContain('"say ""hi"""');
  });

  it("escapes fields containing newlines", () => {
    const rows = [{ note: "line1\nline2" }];
    const csv = toCSV(rows);
    expect(csv).toContain('"line1\nline2"');
  });

  it("renders null/undefined as empty string", () => {
    const rows = [{ a: null, b: undefined }];
    const columns = [
      { key: "a", header: "A" },
      { key: "b", header: "B" },
    ];
    const csv = toCSV(rows, columns);
    const dataLine = csv.split("\n")[1];
    expect(dataLine).toBe(",");
  });

  it("renders numbers without quoting", () => {
    const rows = [{ count: 42 }];
    const csv = toCSV(rows);
    const dataLine = csv.split("\n")[1];
    expect(dataLine).toBe("42");
  });
});

// =============================================================================
// Integration: Full Report Row Lifecycle
// =============================================================================

describe("TTB Report Integration", () => {
  it("a balanced report row passes both validation checks", () => {
    const row = makeRow({
      beginning_inventory_bbl: 100,
      beer_produced_bbl: 50,
      beer_received_bbl: 10,
      total_available_bbl: 160,
      taxpaid_domestic_bbl: 80,
      taxpaid_export_bbl: 5,
      tax_free_samples_bbl: 2,
      losses_bbl: 3,
      destroyed_bbl: 0,
      total_removals_bbl: 90,
      ending_inventory_bbl: 70,
    });
    expect(validateRowBalance(row)).toBe(true);
    expect(validateEndingInventory(row)).toBe(true);
  });

  it("totals across tax classes add up to sum of individual fields", () => {
    const rows = [
      makeRow({
        ttb_tax_class: "keg",
        beginning_inventory_bbl: 50,
        beer_produced_bbl: 30,
        total_available_bbl: 80,
        total_removals_bbl: 20,
        ending_inventory_bbl: 60,
      }),
      makeRow({
        ttb_tax_class: "bottled",
        beginning_inventory_bbl: 25,
        beer_produced_bbl: 15,
        total_available_bbl: 40,
        total_removals_bbl: 10,
        ending_inventory_bbl: 30,
      }),
    ];

    const totals = calculateTotals(rows);
    expect(totals.beginningInventory).toBe(75);
    expect(totals.beerProduced).toBe(45);
    expect(totals.totalAvailable).toBe(120);
    expect(totals.totalRemovals).toBe(30);
    expect(totals.endingInventory).toBe(90);
  });

  it("formatted totals display correctly for TTB compliance", () => {
    const rows = [
      makeRow({ ttb_tax_class: "keg", beer_produced_bbl: 7.5 }),
      makeRow({ ttb_tax_class: "bottled", beer_produced_bbl: 2.5 }),
    ];
    const totals = calculateTotals(rows);
    expect(formatTtbBbl(totals.beerProduced)).toBe("10.00");
  });
});
