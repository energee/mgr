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
  formatTtbBbl,
  getTaxClassLabel,
  getYearOptions,
  calculateTotals,
  validateRowBalance,
  validateEndingInventory,
  EMPTY_TOTALS,
  IN_PROCESS_LABEL,
  PACKAGED_TOTAL_MARKER,
  TOTAL_COLUMN_LABEL,
  totalScopeFor,
  totalScopedLineLabel,
  type TTBReportRow,
  type TTBTotals,
  type TTBVolumeField,
} from "@/domain/ttb-utils";
import { toCSV, buildTTBReportCSV, generateTTBPrintHTML } from "@/lib/report-export";

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

  it("sums the packaged classes and leaves the cellar row out of Part I (issue #670)", () => {
    // The cellar row's produced volume is beer *brewed* in the period; the keg
    // and bottled rows' is beer *packaged*. Adding all three counted the same
    // beer at two lifecycle stages. Note the cellar row here also carries a
    // non-zero ending inventory: excluding it must not depend on that column
    // being structurally 0 in production, which is the only reason the old
    // arithmetic looked right for ending inventory.
    const rows = [
      makeRow({
        ttb_tax_class: "keg",
        beer_produced_bbl: 15,
        ending_inventory_bbl: 10,
        losses_bbl: 0.5,
      }),
      makeRow({
        ttb_tax_class: "bottled",
        beer_produced_bbl: 8,
        ending_inventory_bbl: 5,
        losses_bbl: 0.25,
      }),
      makeRow({
        ttb_tax_class: "cellar",
        beer_produced_bbl: 3,
        ending_inventory_bbl: 2,
        losses_bbl: 1.5,
      }),
    ];
    const totals = calculateTotals(rows);
    expect(totals.beerProduced).toBe(23);
    expect(totals.endingInventory).toBe(15);
    // ...but the removals lines DO include the cellar row: a batch-stage loss is
    // beer that left the brewery, and migration 00274 (#603) keeps those rows
    // disjoint from the packaged removals, so nothing is counted twice.
    expect(totals.losses).toBe(2.25);
  });

  it("does not double-count a batch brewed and packaged in the same period (#670)", () => {
    // 62.5 bbl brewed in June and kegged in June, 60 of it surviving packaging:
    // the cellar row reports 62.5 brewed, the keg row reports the same beer as
    // 60 packaged. The Total column used to read 122.5 — roughly twice the beer
    // that existed. The two values differ so an inverted scope predicate would
    // fail here rather than coincide.
    const rows = [
      makeRow({
        ttb_tax_class: "cellar",
        beer_produced_bbl: 62.5,
        total_available_bbl: 62.5,
        in_process_ending_bbl: 0,
      }),
      makeRow({
        ttb_tax_class: "keg",
        beer_produced_bbl: 60,
        total_available_bbl: 60,
        ending_inventory_bbl: 60,
      }),
    ];
    const totals = calculateTotals(rows);
    expect(totals.beerProduced).toBe(60);
    expect(totals.totalAvailable).toBe(60);
  });

  it("still totals the in-process column across every tax class", () => {
    // In-process means the same thing on every row — beer still in a tank — so
    // that column is summed whole. Only the cellar row carries a value today, so
    // scoping it to finished goods would have reported 0 beer in process.
    const rows = [
      makeRow({ ttb_tax_class: "cellar", in_process_ending_bbl: 62.5 }),
      makeRow({ ttb_tax_class: "keg", in_process_ending_bbl: 0 }),
    ];
    expect(calculateTotals(rows).inProcessEnding).toBe(62.5);
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
// Exported report copies: CSV and print (issue #618)
// =============================================================================

describe("buildTTBReportCSV", () => {
  /** A cellar + keg pair, as get_ttb_report returns them. */
  const rows = [
    makeRow({
      ttb_tax_class: "cellar",
      beer_produced_bbl: 62.5,
      total_available_bbl: 62.5,
      in_process_ending_bbl: 62.5,
    }),
    makeRow({
      ttb_tax_class: "keg",
      beginning_inventory_bbl: 100,
      beer_produced_bbl: 20,
      total_available_bbl: 120,
      total_removals_bbl: 30,
      ending_inventory_bbl: 90,
    }),
  ];

  it("labels the in-process line as an end-of-period balance", () => {
    // Period-keyed since migration 00287 (issue #618): the CSV comes from
    // get_ttb_report, whose in-process terms are reconstructed at the period
    // boundaries from the batch audit trail — not a live snapshot.
    const csv = buildTTBReportCSV(rows, 2026, 6);
    expect(csv).toContain("BEER IN PROCESS (END OF PERIOD)");
    expect(csv).toContain("In Process (End of Period)");
    expect(csv).not.toContain("CURRENT SNAPSHOT");
  });

  it("carries the balance note as a trailing note row, naming the period", () => {
    const csv = buildTTBReportCSV(rows, 2026, 6);
    const noteLine = csv
      .split("\n")
      .find((line) => line.includes("period-end balances reconstructed from the batch audit trail"));
    expect(noteLine).toBeDefined();
    expect(noteLine).toContain("NOTE:");
    expect(noteLine).toContain("the end of June 2026");
    // Trailing rows keep the report's column shape: note in "Line Item", rest empty.
    expect(noteLine?.endsWith(",,,")).toBe(true);
  });

  it("discloses the exempt tax class rather than leaving the CSV silent", () => {
    const csv = buildTTBReportCSV(rows, 2026, 6);
    expect(csv).toContain("NOTE: Not accounting-identity checked:");
    expect(csv).toContain("Cellar (In-Process)");
  });

  it("omits the exemption note when every class in the report was checked", () => {
    const csv = buildTTBReportCSV([rows[1]], 2026, 6);
    expect(csv).not.toContain("Not accounting-identity checked");
    // The in-process balance note still applies — the line always needs its
    // measurement explained.
    expect(csv).toContain("period-end balances reconstructed from the batch audit trail");
  });

  it("leaks no internal tracker reference into the filed artifact", () => {
    expect(buildTTBReportCSV(rows, 2026, 6)).not.toContain("#618");
  });

  it("keeps the CSV and the print copy carrying the same two notes", () => {
    const csv = buildTTBReportCSV(rows, 2026, 6);
    const html = generateTTBPrintHTML(rows, 2026, 6);
    for (const fragment of [
      "period-end balances reconstructed from the batch audit trail",
      "Not accounting-identity checked:",
    ]) {
      expect(csv).toContain(fragment);
      expect(html).toContain(fragment);
    }
    expect(html).not.toContain("#618");
  });
});

// =============================================================================
// Total column: one rule across screen, CSV and print (issue #670)
// =============================================================================

/** The Total cell of one CSV data line, parsed back to a number. */
function csvTotal(csv: string, label: string): number {
  const line = csv.split("\n").find((l) => l.startsWith(`${label},`));
  if (!line) throw new Error(`no CSV data line labelled "${label}"`);
  return Number(line.split(",").pop());
}

/** The Total cell of one print-view table row, parsed back to a number. */
function printTotal(html: string, label: string): number {
  const row = html.split("<tr").find((r) => r.includes(`>${label}</td>`));
  if (!row) throw new Error(`no print row labelled "${label}"`);
  const cells = [...row.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((m) => m[1]);
  return Number(cells[cells.length - 1]);
}

describe("Total column parity (issue #670)", () => {
  /**
   * A cellar + keg + bottled report where the cellar row's brewed volume
   * overlaps the packaged rows, and every column is non-zero, so a surface that
   * summed the wrong set of rows shows a different number. Values are chosen so
   * no packaged total coincides with the cellar cell it excludes — an inverted
   * scope predicate must change the numbers, not reproduce them.
   */
  const rows: TTBReportRow[] = [
    makeRow({
      ttb_tax_class: "cellar",
      beer_produced_bbl: 62.5,
      total_available_bbl: 62.5,
      losses_bbl: 1.5,
      total_removals_bbl: 1.5,
      // Deliberately non-zero: production has 0 here, and the Part I exclusion
      // must not rely on that.
      beginning_inventory_bbl: 4,
      ending_inventory_bbl: 3,
      in_process_beginning_bbl: 40,
      in_process_ending_bbl: 62.5,
    }),
    makeRow({
      ttb_tax_class: "keg",
      beginning_inventory_bbl: 100,
      beer_produced_bbl: 40,
      total_available_bbl: 140,
      taxpaid_domestic_bbl: 30,
      taxpaid_export_bbl: 2,
      tax_free_samples_bbl: 1,
      losses_bbl: 0.5,
      destroyed_bbl: 0.25,
      total_removals_bbl: 33.75,
      ending_inventory_bbl: 106.25,
    }),
    makeRow({
      ttb_tax_class: "bottled",
      beginning_inventory_bbl: 20,
      beer_produced_bbl: 25,
      total_available_bbl: 45,
      taxpaid_domestic_bbl: 8,
      total_removals_bbl: 8,
      ending_inventory_bbl: 37,
    }),
  ];

  /**
   * Every data line of the report: its base label, the `TTBTotals` field behind
   * it, and the column it sums. The rendered label comes from
   * `totalScopedLineLabel`, so the packaged-only lines are looked up by their
   * marked label — if a surface stopped marking them, these lookups throw.
   */
  const lines: [label: string, totalsField: keyof TTBTotals, column: TTBVolumeField][] = [
    ["Beginning Inventory", "beginningInventory", "beginning_inventory_bbl"],
    ["Beer Produced/Packaged", "beerProduced", "beer_produced_bbl"],
    ["Total Available", "totalAvailable", "total_available_bbl"],
    ["Taxpaid (Domestic)", "taxpaidDomestic", "taxpaid_domestic_bbl"],
    ["Taxpaid (Export)", "taxpaidExport", "taxpaid_export_bbl"],
    ["Tax-Free Samples", "taxFreeSamples", "tax_free_samples_bbl"],
    ["Losses", "losses", "losses_bbl"],
    ["Destroyed", "destroyed", "destroyed_bbl"],
    ["Total Removals", "totalRemovals", "total_removals_bbl"],
    ["Ending Inventory", "endingInventory", "ending_inventory_bbl"],
    [IN_PROCESS_LABEL, "inProcessEnding", "in_process_ending_bbl"],
  ];

  it("agrees line for line between the screen totals, the CSV and the print view", () => {
    // The drift guard: all three surfaces derive their Total from the same
    // helper, and this fails if any one of them starts re-deriving its own.
    const totals = calculateTotals(rows);
    const csv = buildTTBReportCSV(rows, 2026, 6);
    const html = generateTTBPrintHTML(rows, 2026, 6);

    for (const [label, totalsField, column] of lines) {
      const rendered = totalScopedLineLabel(rows, label, column);
      expect(csvTotal(csv, rendered), `CSV total for ${label}`).toBe(totals[totalsField]);
      expect(printTotal(html, rendered), `print total for ${label}`).toBe(totals[totalsField]);
    }
  });

  it("excludes the cellar row from the Part I totals on all three surfaces", () => {
    const csv = buildTTBReportCSV(rows, 2026, 6);
    const html = generateTTBPrintHTML(rows, 2026, 6);
    const totals = calculateTotals(rows);
    const produced = totalScopedLineLabel(rows, "Beer Produced/Packaged", "beer_produced_bbl");

    // 40 + 25 packaged, NOT + 62.5 brewed.
    expect(totals.beerProduced).toBe(65);
    expect(csvTotal(csv, produced)).toBe(65);
    expect(printTotal(html, produced)).toBe(65);

    // Beginning/ending inventory are scoped by tax class, not by the cellar row
    // happening to hold zeros — this fixture gives it 4 and 3.
    expect(totals.beginningInventory).toBe(120);
    expect(totals.endingInventory).toBe(143.25);
    expect(csvTotal(csv, totalScopedLineLabel(rows, "Ending Inventory", "ending_inventory_bbl"))).toBe(
      143.25
    );
  });

  it("keeps the cellar row's removals IN the removals totals (00274 / issue #603)", () => {
    // The cellar's 1.5 bbl loss is beer that left the brewery. Migration 00274
    // admitted it onto Form 5130.9 and excludes packaging and inter-vessel
    // movements so it can never overlap a packaged removal — dropping it here
    // would understate removals on a filing-prep figure.
    const csv = buildTTBReportCSV(rows, 2026, 6);
    const html = generateTTBPrintHTML(rows, 2026, 6);
    const totals = calculateTotals(rows);

    expect(totals.losses).toBe(2); // 1.5 cellar + 0.5 keg
    expect(totals.totalRemovals).toBe(43.25); // 1.5 + 33.75 + 8
    expect(csvTotal(csv, "Losses")).toBe(2);
    expect(printTotal(html, "Total Removals")).toBe(43.25);
  });

  it("marks the packaged-only lines and leaves the removals lines unmarked", () => {
    const csv = buildTTBReportCSV(rows, 2026, 6);
    const html = generateTTBPrintHTML(rows, 2026, 6);

    for (const [label, , column] of lines) {
      const rendered = totalScopedLineLabel(rows, label, column);
      const marked = totalScopeFor(column) === "packaged-only";
      expect(rendered.endsWith(PACKAGED_TOTAL_MARKER), `${label} marker`).toBe(marked);
      expect(csv, `${label} in CSV`).toContain(`\n${rendered},`);
      expect(html, `${label} in print`).toContain(`>${rendered}</td>`);
    }
    // The unmarked ones are not marked anywhere either.
    expect(csv).not.toContain(`Total Removals ${PACKAGED_TOTAL_MARKER}`);
    expect(html).not.toContain(`Total Removals ${PACKAGED_TOTAL_MARKER}`);
  });

  it("keeps the cellar row's own cells intact — only the Total changed", () => {
    const csv = buildTTBReportCSV(rows, 2026, 6);
    const produced = totalScopedLineLabel(rows, "Beer Produced/Packaged", "beer_produced_bbl");
    const producedLine = csv.split("\n").find((l) => l.startsWith(`${produced},`));
    // Line Item, Cellar, Kegs, Canned/Bottled, Total
    expect(producedLine?.split(",")).toEqual([produced, "62.5", "40", "25", "65"]);
  });

  it("heads the column plainly, because its scope is per line, not per column", () => {
    const csv = buildTTBReportCSV(rows, 2026, 6);
    const html = generateTTBPrintHTML(rows, 2026, 6);
    expect(TOTAL_COLUMN_LABEL).toBe("Total");
    // CSV header row is the last column; print view is the last <th>.
    expect(csv.split("\n")[0].split(",").pop()).toBe(TOTAL_COLUMN_LABEL);
    expect(html).toContain(`>${TOTAL_COLUMN_LABEL}</th>`);
  });

  it("carries the same Total-column explanation in the CSV and the print view", () => {
    const csv = buildTTBReportCSV(rows, 2026, 6);
    const html = generateTTBPrintHTML(rows, 2026, 6);
    for (const fragment of [
      `${PACKAGED_TOTAL_MARKER} Total on the marked lines covers the packaged tax classes only`,
      "Cellar (In-Process)",
      "Every other line totals all tax classes",
      "left the brewery and no packaged line reports it again",
      // Issue #698: since checkTotalColumnCrossFoot verifies the column, the
      // caveat states the checked relationship instead of disclaiming it.
      "add those removals back and the column cross-foots",
    ]) {
      expect(csv).toContain(fragment);
      expect(html).toContain(fragment);
    }
    expect(csv).not.toContain("#670");
    expect(html).not.toContain("#670");
  });

  it("omits the scope note entirely when no class in the report is scoped out", () => {
    // Nothing to mark, so nothing to explain — the note must not appear as
    // boilerplate on a report it does not describe.
    const packagedOnly = rows.filter((r) => r.ttb_tax_class !== "cellar");
    const csv = buildTTBReportCSV(packagedOnly, 2026, 6);
    const html = generateTTBPrintHTML(packagedOnly, 2026, 6);
    expect(csv).not.toContain(PACKAGED_TOTAL_MARKER);
    expect(html).not.toContain(PACKAGED_TOTAL_MARKER);
    expect(csv).not.toContain("does not cross-foot");
    expect(html).not.toContain("does not cross-foot");
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
