// @vitest-environment node
/**
 * The TTB CSV/print exports must render the same barrel figures as the
 * on-screen report — see the docstrings in report-export.ts (issues #618,
 * #670). The screen formats every _bbl figure with `formatTtbBbl` (fixed 2
 * decimals, required for a federal regulatory form). This guards against the
 * export drifting onto a different formatter that drops trailing zeros.
 */

import { describe, it, expect } from "vitest";
import { buildTTBReportCSV, type TTBReportData } from "@/lib/report-export";
import type { TTBReportRow } from "@/domain/ttb-utils";

function makeRow(overrides: Partial<TTBReportRow> = {}): TTBReportRow {
  return {
    report_year: 2026,
    report_month: 6,
    report_period: "2026-06",
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

describe("buildTTBReportCSV", () => {
  it("formats barrel figures the same way the on-screen report does", () => {
    const rows: TTBReportData[] = [
      makeRow({
        ttb_tax_class: "keg",
        beginning_inventory_bbl: 100,
        beer_produced_bbl: 62.5,
      }),
    ];

    const csv = buildTTBReportCSV(rows, 2026, 6);
    const lines = csv.split("\n");
    const header = lines[0].split(",");
    // lines[1] is the "PART I - OPERATIONS" section-header row.
    const beginningRow = lines[2].split(",");
    const producedRow = lines[3].split(",");

    const kegCol = header.indexOf("Kegs");
    const totalCol = header.indexOf("Total");

    // formatTtbBbl(100) === "100.00", not formatBbl(100) === "100".
    expect(beginningRow[kegCol]).toBe("100.00");
    expect(beginningRow[totalCol]).toBe("100.00");
    // formatTtbBbl(62.5) === "62.50", not formatBbl(62.5) === "62.5".
    expect(producedRow[kegCol]).toBe("62.50");
    expect(producedRow[totalCol]).toBe("62.50");
  });

  it("renders a zero volume as 0.00, matching the screen's compliance formatting", () => {
    const rows: TTBReportData[] = [makeRow({ ttb_tax_class: "keg" })];

    const csv = buildTTBReportCSV(rows, 2026, 6);
    const lines = csv.split("\n");
    const header = lines[0].split(",");
    // lines[1] is the "PART I - OPERATIONS" section-header row.
    const beginningRow = lines[2].split(",");

    const kegCol = header.indexOf("Kegs");
    expect(beginningRow[kegCol]).toBe("0.00");
  });
});
