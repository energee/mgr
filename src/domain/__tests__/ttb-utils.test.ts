// @vitest-environment node
/**
 * Tests for TTB Form 5130.9 pure helpers (src/domain/ttb-utils.ts):
 * barrel/gallon conversion, compliance-safe decimal formatting, tax class
 * label lookup, report-period year options, and the scoping of the
 * accounting-identity checks to the tax classes they can verify (issue #618).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  formatTtbBbl,
  getTaxClassLabel,
  getYearOptions,
  checkRowIdentities,
  collectIdentityFailures,
  collectIdentityExemptions,
  getIdentityExemptionReason,
  isIdentityCheckedTaxClass,
  validateEndingInventory,
  IDENTITY_CHECKED_TAX_CLASSES,
  type TTBReportRow,
} from "@/domain/ttb-utils";

afterEach(() => {
  vi.useRealTimers();
});

/** Factory for a TTB report row with every volume zeroed. */
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

/**
 * A realistic cellar row as get_ttb_report actually composes one: no finished
 * good is ever classed 'cellar', so beginning/ending inventory are structurally
 * 0, available comes from the batches brewed in the period, removals come from
 * batch-sourced cellar losses (migration 00274), and the row's real balance
 * sits in the in-process columns that neither identity references.
 */
function makeCellarRow(): TTBReportRow {
  return makeRow({
    ttb_tax_class: "cellar",
    beginning_inventory_bbl: 0,
    beer_produced_bbl: 62.5,
    total_available_bbl: 62.5,
    losses_bbl: 1.5,
    total_removals_bbl: 1.5,
    ending_inventory_bbl: 0,
    in_process_beginning_bbl: 40,
    in_process_ending_bbl: 62.5,
  });
}

/** A keg row whose ending inventory ignores its removals — a real math break. */
function makeBrokenKegRow(): TTBReportRow {
  return makeRow({
    ttb_tax_class: "keg",
    beginning_inventory_bbl: 100,
    beer_produced_bbl: 20,
    total_available_bbl: 120,
    taxpaid_domestic_bbl: 30,
    total_removals_bbl: 30,
    ending_inventory_bbl: 120, // should be 90
  });
}


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
    // Pin the clock so this doesn't flake once a year at the midnight
    // boundary between the test's `new Date()` read and getYearOptions'
    // own internal read. With the system clock fixed at 2026-07-01, the
    // current year is 2026, so getYearOptions() must return exactly
    // [2026, 2025, 2024, 2023].
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00"));
    expect(getYearOptions()).toEqual([2026, 2025, 2024, 2023]);
  });
});

describe("identity-check scoping (issue #618)", () => {
  it("checks only the finished-goods tax classes the identities apply to", () => {
    expect(IDENTITY_CHECKED_TAX_CLASSES).toEqual(["keg", "bottled"]);
    expect(isIdentityCheckedTaxClass("keg")).toBe(true);
    expect(isIdentityCheckedTaxClass("bottled")).toBe(true);
    expect(isIdentityCheckedTaxClass("cellar")).toBe(false);
  });

  it("gives a reason for every exempt class, and none for a checked class", () => {
    expect(getIdentityExemptionReason("keg")).toBeNull();
    expect(getIdentityExemptionReason("cellar")).toContain("in-process");
    expect(getIdentityExemptionReason("cellar")).toContain("#618");
    // An unrecognized class is still explicitly exempt, never silently passed.
    expect(getIdentityExemptionReason("barrel_aged")).toBeTruthy();
  });

  it("reports the cellar row as exempt, not as a passing check", () => {
    const check = checkRowIdentities(makeCellarRow());
    expect(check.status).toBe("exempt");
    expect(check.label).toBe("Cellar (In-Process)");
    // "exempt" must be distinguishable from "checked with no failures".
    expect(check).not.toHaveProperty("failures");
  });

  it("does NOT report a cellar row as a validation failure", () => {
    const cellar = makeCellarRow();
    // The raw identity genuinely does not hold for this row — that is exactly
    // why the report used to fire its "review before filing" warning on every
    // month an active brewery had.
    expect(validateEndingInventory(cellar)).toBe(false);
    // Scoped through checkRowIdentities, it is exempt, so nothing is reported.
    expect(collectIdentityFailures([cellar].map(checkRowIdentities))).toEqual([]);
  });

  it("still fails a genuinely broken keg row", () => {
    const check = checkRowIdentities(makeBrokenKegRow());
    expect(check.status).toBe("checked");
    const failures = collectIdentityFailures([check]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("Kegs");
    expect(failures[0]).toContain("ending inventory");
  });

  it("passes a balanced keg row with no failures", () => {
    const check = checkRowIdentities(
      makeRow({
        beginning_inventory_bbl: 100,
        beer_produced_bbl: 20,
        beer_received_bbl: 5,
        total_available_bbl: 125,
        taxpaid_domestic_bbl: 25,
        total_removals_bbl: 25,
        ending_inventory_bbl: 100,
      })
    );
    expect(check.status).toBe("checked");
    expect(collectIdentityFailures([check])).toEqual([]);
  });

  it("keeps the broken keg row's failure visible alongside an exempt cellar row", () => {
    const checks = [makeCellarRow(), makeBrokenKegRow()].map(checkRowIdentities);
    expect(collectIdentityFailures(checks)).toHaveLength(1);
    expect(collectIdentityExemptions(checks).map((c) => c.taxClass)).toEqual(["cellar"]);
  });

  it("flags a broken total-available identity on a bottled row", () => {
    const failures = collectIdentityFailures([
      checkRowIdentities(
        makeRow({
          ttb_tax_class: "bottled",
          beginning_inventory_bbl: 10,
          beer_produced_bbl: 5,
          total_available_bbl: 99, // should be 15
          ending_inventory_bbl: 99,
        })
      ),
    ]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("Canned/Bottled");
    expect(failures[0]).toContain("total available");
  });
});
