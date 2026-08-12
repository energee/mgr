// @vitest-environment node
/**
 * Tests for TTB Form 5130.9 pure helpers (src/domain/ttb-utils.ts):
 * barrel/gallon conversion, compliance-safe decimal formatting, tax class
 * label lookup, report-period year options, the scoping of the
 * accounting-identity checks to the tax classes they can verify (issue #618),
 * and the per-column scoping of the report's Total to the tax classes whose
 * cells are commensurable on that column (issue #670).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  formatTtbBbl,
  getTaxClassLabel,
  getYearOptions,
  checkRowIdentities,
  checkTotalColumnCrossFoot,
  collectIdentityFailures,
  collectIdentityExemptions,
  formatIdentityExemptionDisclosure,
  getIdentityExemptionReason,
  getInProcessBalanceNote,
  getReportExemptionDisclosure,
  isIdentityCheckedTaxClass,
  getSummaryCardScopeNote,
  getTotalScopeCaveat,
  totalForColumn,
  totalScopeFor,
  totalScopedLineLabel,
  validateEndingInventory,
  IDENTITY_EXEMPT_TAX_CLASSES,
  PACKAGED_TOTAL_MARKER,
  TOTAL_COLUMN_LABEL,
  type TTBReportRow,
  type TTBVolumeField,
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
  it("exempts exactly the enumerated classes and checks everything else", () => {
    expect(IDENTITY_EXEMPT_TAX_CLASSES).toEqual(["cellar"]);
    expect(isIdentityCheckedTaxClass("keg")).toBe(true);
    expect(isIdentityCheckedTaxClass("bottled")).toBe(true);
    expect(isIdentityCheckedTaxClass("cellar")).toBe(false);
  });

  it("gives a reason for every exempt class, and none for a checked class", () => {
    expect(getIdentityExemptionReason("keg")).toBeNull();
    expect(getIdentityExemptionReason("cellar")).toContain("in-process");
  });

  it("keeps internal tracker references out of the compliance officer's copy", () => {
    // The reason string is rendered verbatim on the filing-prep screen and in
    // the CSV/print exports. A GitHub issue number has no business there — it
    // belongs in the code comment on IDENTITY_EXEMPT_TAX_CLASSES.
    const reason = getIdentityExemptionReason("cellar") ?? "";
    expect(reason).not.toContain("#618");
    expect(reason).not.toContain("issue");
  });

  it("defaults an unknown tax class to CHECKED, not silently exempt", () => {
    // A future finished-goods class (barrel-aged, cider) must fall into the loud
    // "review before filing" alert, never into the quiet exemption footnote.
    expect(isIdentityCheckedTaxClass("barrel_aged")).toBe(true);
    expect(getIdentityExemptionReason("barrel_aged")).toBeNull();

    const check = checkRowIdentities(
      makeRow({
        ttb_tax_class: "barrel_aged",
        beginning_inventory_bbl: 10,
        beer_produced_bbl: 5,
        total_available_bbl: 15,
        total_removals_bbl: 4,
        ending_inventory_bbl: 15, // should be 11
      })
    );
    expect(check.status).toBe("checked");
    const failures = collectIdentityFailures([check]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("barrel_aged");
    expect(collectIdentityExemptions([check])).toEqual([]);
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

describe("Total column scoping (issue #670)", () => {
  it("adds only the identity-checked classes on a Part I column", () => {
    const rows = [
      makeCellarRow(), // produced 62.5 = beer BREWED in the period, available 62.5
      makeRow({ ttb_tax_class: "keg", beer_produced_bbl: 40, total_available_bbl: 140 }),
      makeRow({ ttb_tax_class: "bottled", beer_produced_bbl: 25, total_available_bbl: 45 }),
    ];
    // 40 + 25 packaged. The cellar row's 62.5 is the same beer before packaging.
    // Deliberately != 62.5, so an inverted scope predicate cannot pass this.
    expect(totalForColumn(rows, "beer_produced_bbl")).toBe(65);
    // total_available inherits the same mixing, so it is scoped the same way.
    expect(totalForColumn(rows, "total_available_bbl")).toBe(185);
  });

  it("adds every class on a removals column — cellar removals are not duplicated", () => {
    // Migration 00274 (issue #603) admitted batch-sourced cellar removals onto
    // the form and excludes destination_type finished_good/transfer/batch so
    // they cannot overlap a packaged removal. Dropping them here would
    // understate removals on a filing-prep figure.
    const rows = [
      makeCellarRow(), // losses 1.5, total_removals 1.5
      makeRow({ ttb_tax_class: "keg", losses_bbl: 0.5, total_removals_bbl: 0.5 }),
    ];
    expect(totalForColumn(rows, "losses_bbl")).toBe(2);
    expect(totalForColumn(rows, "total_removals_bbl")).toBe(2);
    expect(totalForColumn(rows, "destroyed_bbl")).toBe(0);
  });

  it("adds every class on an in-process column, where the cells mean one thing", () => {
    const rows = [
      makeCellarRow(), // in_process_ending 62.5
      makeRow({ ttb_tax_class: "keg", in_process_ending_bbl: 0 }),
    ];
    // Scoping this to packaged classes would report 0 beer in process: only the
    // cellar class ever carries in-process volume (migration 00237).
    expect(totalForColumn(rows, "in_process_ending_bbl")).toBe(62.5);
    expect(totalForColumn(rows, "in_process_beginning_bbl")).toBe(40);
  });

  it("classifies every volume column, Part I packaged-only and the rest whole", () => {
    // The scope map is the contract; this pins it column by column so a
    // reclassification is a deliberate, visible edit rather than a side effect.
    const packagedOnly: TTBVolumeField[] = [
      "beginning_inventory_bbl",
      "beer_produced_bbl",
      "beer_received_bbl",
      "total_available_bbl",
      "ending_inventory_bbl",
    ];
    const allClasses: TTBVolumeField[] = [
      "taxpaid_domestic_bbl",
      "taxpaid_export_bbl",
      "tax_free_samples_bbl",
      "losses_bbl",
      "destroyed_bbl",
      "adjustments_bbl",
      "total_removals_bbl",
      "in_process_beginning_bbl",
      "in_process_ending_bbl",
    ];
    for (const field of packagedOnly) expect(totalScopeFor(field)).toBe("packaged-only");
    for (const field of allClasses) expect(totalScopeFor(field)).toBe("all-classes");
    // Every `_bbl` column of the row shape is covered by one of the two lists,
    // so a column added later without a scope shows up here as well as failing
    // to type-check against Record<TTBVolumeField, TTBTotalScope>.
    const covered = [...packagedOnly, ...allClasses].sort();
    const declared = (Object.keys(makeRow()) as (keyof TTBReportRow)[])
      .filter((key): key is TTBVolumeField => key.endsWith("_bbl"))
      .sort();
    expect(covered).toEqual(declared);
  });

  it("excludes an exempt row's ending inventory by tax class, not because it is 0", () => {
    // ending_inventory_bbl is structurally 0 on the cellar row today (00237's
    // fg_ending groups by get_ttb_tax_class, which never returns 'cellar'), and
    // that is the only reason the old all-rows sum looked right for this column.
    // Give the row a real number and the exclusion must still hold.
    const rows = [
      makeRow({ ttb_tax_class: "cellar", ending_inventory_bbl: 99 }),
      makeRow({ ttb_tax_class: "keg", ending_inventory_bbl: 10 }),
    ];
    expect(totalForColumn(rows, "ending_inventory_bbl")).toBe(10);
  });

  it("keeps available = beginning + produced + received exact down the Total column", () => {
    // Scoping all of Part I the same way is what makes this hold: it holds on
    // each packaged row, and the Total is a plain sum of those rows.
    const rows = [
      makeCellarRow(),
      makeRow({
        ttb_tax_class: "keg",
        beginning_inventory_bbl: 100,
        beer_produced_bbl: 40,
        total_available_bbl: 140,
      }),
      makeRow({
        ttb_tax_class: "bottled",
        beginning_inventory_bbl: 20,
        beer_produced_bbl: 25,
        total_available_bbl: 45,
      }),
    ];
    expect(totalForColumn(rows, "total_available_bbl")).toBe(
      totalForColumn(rows, "beginning_inventory_bbl") +
        totalForColumn(rows, "beer_produced_bbl") +
        totalForColumn(rows, "beer_received_bbl")
    );
  });

  it("does NOT cross-foot: available - removals lands BELOW ending, by the cellar removals", () => {
    // The documented consequence of mixing scopes down one column: the cellar's
    // removals are real (00274) but draw down no packaged available, so the
    // subtraction comes up short — the ending inventory does not. Sign matters:
    // `gap` is NEGATIVE, i.e. ending EXCEEDS available - removals. Pinned so the
    // excess stays exactly this and nothing else.
    const cellar = makeCellarRow(); // total_removals 1.5
    const rows = [
      cellar,
      makeRow({
        ttb_tax_class: "keg",
        beginning_inventory_bbl: 100,
        beer_produced_bbl: 40,
        total_available_bbl: 140,
        total_removals_bbl: 33.75,
        ending_inventory_bbl: 106.25,
      }),
    ];
    const gap =
      totalForColumn(rows, "total_available_bbl") -
      totalForColumn(rows, "total_removals_bbl") -
      totalForColumn(rows, "ending_inventory_bbl");
    expect(gap).toBeCloseTo(-cellar.total_removals_bbl, 10);
  });

  it("derives the excluded classes from the identity-exemption list, not a second list", () => {
    // One list drives both, so the two cannot drift: a class that stops being
    // exempt starts being summed in the same edit.
    for (const taxClass of IDENTITY_EXEMPT_TAX_CLASSES) {
      const rows = [
        makeRow({ ttb_tax_class: taxClass, beer_produced_bbl: 7 }),
        makeRow({ ttb_tax_class: "keg", beer_produced_bbl: 3 }),
      ];
      expect(isIdentityCheckedTaxClass(taxClass)).toBe(false);
      expect(totalForColumn(rows, "beer_produced_bbl")).toBe(3);
    }
  });

  it("sums a tax class nobody has thought about yet, matching the identity default", () => {
    // Fail-closed stays consistent across both scopings: an unknown class is
    // checked by the identities and counted in the Total.
    const rows = [
      makeRow({ ttb_tax_class: "barrel_aged", beer_produced_bbl: 5 }),
      makeRow({ ttb_tax_class: "keg", beer_produced_bbl: 3 }),
    ];
    expect(totalForColumn(rows, "beer_produced_bbl")).toBe(8);
  });

  it("returns 0 for an empty report", () => {
    expect(totalForColumn([], "beer_produced_bbl")).toBe(0);
    expect(totalForColumn([], "in_process_ending_bbl")).toBe(0);
  });
});

describe("line labels marked as packaged-only (issue #670)", () => {
  it("marks a Part I line and leaves a removals line unmarked", () => {
    const rows = [makeCellarRow(), makeRow({ ttb_tax_class: "keg" })];
    expect(totalScopedLineLabel(rows, "Total Available", "total_available_bbl")).toBe(
      `Total Available ${PACKAGED_TOTAL_MARKER}`
    );
    expect(totalScopedLineLabel(rows, "Total Removals", "total_removals_bbl")).toBe(
      "Total Removals"
    );
    expect(totalScopedLineLabel(rows, "In Process", "in_process_ending_bbl")).toBe("In Process");
  });

  it("uses the same marker the caveat opens with", () => {
    const caveat = getTotalScopeCaveat([makeCellarRow()]);
    expect(caveat?.startsWith(PACKAGED_TOTAL_MARKER)).toBe(true);
  });

  it("marks nothing when the report holds no exempt class", () => {
    // A marker whose footnote says nothing was left out is noise, and the
    // footnote is suppressed in that case too — one gate drives both.
    const packagedOnly = [makeRow({ ttb_tax_class: "keg" })];
    expect(totalScopedLineLabel(packagedOnly, "Total Available", "total_available_bbl")).toBe(
      "Total Available"
    );
    expect(getTotalScopeCaveat(packagedOnly)).toBeNull();
  });
});

describe("Total column caveat (issue #670)", () => {
  const rows = [makeCellarRow(), makeRow({ ttb_tax_class: "keg" })];

  it("names the column, the class left out, and the reason that class is out", () => {
    const caveat = getTotalScopeCaveat(rows) ?? "";
    expect(caveat).toContain(TOTAL_COLUMN_LABEL);
    expect(caveat).toContain("Cellar (In-Process)");
    expect(caveat).toContain("beer brewed during the period");
  });

  it("says the removals lines DO cover every class, and why that is not a double count", () => {
    // The heart of the fix: cellar removals reach the form only because
    // migration 00274 put them there, and 00274 excludes packaging and
    // inter-vessel movements so they cannot overlap a packaged removal. The
    // caveat must not offer the double-count reason for them.
    const caveat = getTotalScopeCaveat(rows) ?? "";
    expect(caveat).toContain("Every other line totals all tax classes");
    expect(caveat).toContain("left the brewery and no packaged line reports it again");
  });

  it("states the checked cross-foot identity instead of disclaiming the column (issue #698)", () => {
    // Since checkTotalColumnCrossFoot exists, the Total column's arithmetic IS
    // verified — accounting for the cellar removals explicitly — so the caveat
    // must state the checked relationship, not apologize that nothing checks it.
    const caveat = getTotalScopeCaveat(rows) ?? "";
    expect(caveat).not.toContain("does not cross-foot");
    expect(caveat).toContain("cross-foots");
    expect(caveat).toContain("checks automatically");
  });

  it("states the cross-foot direction the way the arithmetic actually goes", () => {
    // The first version of this caveat said ending inventory was "short of"
    // available minus removals. It is the other way round: the cellar's
    // removals inflate the subtrahend, so `available - removals` lands BELOW
    // ending inventory. A reader told ending was short would go hunting for
    // beer that is not missing. Asserted against the computed sign rather than
    // against a fixed string, so the prose cannot drift away from the numbers.
    const gap =
      totalForColumn(rows, "total_available_bbl") -
      totalForColumn(rows, "total_removals_bbl") -
      totalForColumn(rows, "ending_inventory_bbl");
    expect(gap).toBeLessThan(0); // ending exceeds available - removals

    const caveat = getTotalScopeCaveat(rows) ?? "";
    expect(caveat).toContain("below ending inventory");
    expect(caveat).not.toMatch(/ending inventory is short/i);
  });

  it("takes the excluded class names from the exemption list", () => {
    const caveat = getTotalScopeCaveat(rows) ?? "";
    for (const taxClass of IDENTITY_EXEMPT_TAX_CLASSES) {
      expect(caveat).toContain(getTaxClassLabel(taxClass));
    }
  });

  it("returns null when the report holds no exempt class, so no line is marked", () => {
    const packagedOnlyReport = [
      makeRow({ ttb_tax_class: "keg" }),
      makeRow({ ttb_tax_class: "bottled" }),
    ];
    expect(getTotalScopeCaveat(packagedOnlyReport)).toBeNull();
    expect(getTotalScopeCaveat([])).toBeNull();
  });

  it("carries no internal tracker reference into the compliance officer's copy", () => {
    const caveat = getTotalScopeCaveat(rows) ?? "";
    expect(caveat).not.toContain("#670");
    expect(caveat).not.toContain("issue");
  });
});

describe("Total column cross-foot check (issue #698)", () => {
  /** A report whose packaged rows balance; the cellar row carries removals. */
  function balancedReport(): TTBReportRow[] {
    return [
      makeCellarRow(), // total_removals 1.5, ending structurally 0
      makeRow({
        ttb_tax_class: "keg",
        beginning_inventory_bbl: 100,
        beer_produced_bbl: 40,
        total_available_bbl: 140,
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
  }

  it("passes a report whose packaged rows balance, accounting for the cellar removals explicitly", () => {
    const rows = balancedReport();
    // The naive subtraction genuinely does not foot — that is issue #698's gap…
    const naiveGap =
      totalForColumn(rows, "total_available_bbl") -
      totalForColumn(rows, "total_removals_bbl") -
      totalForColumn(rows, "ending_inventory_bbl");
    expect(naiveGap).toBeCloseTo(-1.5, 10); // exactly the cellar removals
    // …so the check must add the exempt classes' removals back, not assert the
    // identity that provably cannot hold.
    expect(checkTotalColumnCrossFoot(rows)).toBeNull();
  });

  it("flags a Total column that breaks even after the cellar removals are added back", () => {
    const rows = [makeCellarRow(), makeBrokenKegRow()];
    const failure = checkTotalColumnCrossFoot(rows);
    expect(failure).not.toBeNull();
    expect(failure).toContain(TOTAL_COLUMN_LABEL);
    expect(failure).toContain("ending inventory");
  });

  it("keeps internal tracker references out of the failure copy", () => {
    const failure = checkTotalColumnCrossFoot([makeCellarRow(), makeBrokenKegRow()]) ?? "";
    expect(failure).not.toContain("#698");
    expect(failure).not.toContain("issue");
  });

  it("uses the same 0.005 bbl tolerance as the per-row identities", () => {
    const nearlyBalanced = balancedReport().map((row) =>
      row.ttb_tax_class === "keg" ? { ...row, ending_inventory_bbl: 106.254 } : row
    );
    expect(checkTotalColumnCrossFoot(nearlyBalanced)).toBeNull();
    const over = balancedReport().map((row) =>
      row.ttb_tax_class === "keg" ? { ...row, ending_inventory_bbl: 106.26 } : row
    );
    expect(checkTotalColumnCrossFoot(over)).not.toBeNull();
  });

  it("reduces to the plain identity when the report holds no exempt class", () => {
    const packagedOnly = [
      makeRow({
        ttb_tax_class: "keg",
        total_available_bbl: 50,
        total_removals_bbl: 10,
        ending_inventory_bbl: 40,
      }),
    ];
    expect(checkTotalColumnCrossFoot(packagedOnly)).toBeNull();
    expect(checkTotalColumnCrossFoot([])).toBeNull();
  });
});

describe("summary card scope note (issue #670)", () => {
  const rows = [
    makeCellarRow(),
    makeRow({ ttb_tax_class: "keg" }),
    makeRow({ ttb_tax_class: "bottled" }),
  ];

  it("names the packaged classes and says Total Removals is not one of them", () => {
    const note = getSummaryCardScopeNote(rows) ?? "";
    expect(note).toContain("Beginning Inventory, Beer Packaged and Ending Inventory");
    expect(note).toContain("Kegs and Canned/Bottled");
    expect(note).toContain("Cellar (In-Process)");
    expect(note).toContain("Total Removals covers every tax class");
  });

  it("derives both lists from the rows rather than naming classes literally", () => {
    const note = getSummaryCardScopeNote([makeCellarRow(), makeRow({ ttb_tax_class: "keg" })]) ?? "";
    expect(note).toContain("Kegs");
    expect(note).not.toContain("Canned/Bottled");
  });

  it("returns null when nothing is excluded", () => {
    expect(getSummaryCardScopeNote([makeRow({ ttb_tax_class: "keg" })])).toBeNull();
    expect(getSummaryCardScopeNote([])).toBeNull();
  });

  it("carries no internal tracker reference", () => {
    expect(getSummaryCardScopeNote(rows)).not.toContain("#670");
  });
});

describe("disclosure text shared by screen, CSV and print (issue #618)", () => {
  it("describes the in-process figures as period-end balances from the audit trail, naming the period", () => {
    // Migration 00286 keys the in-process terms on batch status *history*
    // (entity_revisions) at the period boundaries, so the old "current
    // snapshot" caveat would now be false: closed months ARE reproducible.
    const note = getInProcessBalanceNote("June 2026");
    expect(note).toContain("fermenting");
    expect(note).toContain("the end of June 2026");
    expect(note).toContain("audit trail");
    expect(note).not.toContain("snapshot");
  });

  it("falls back to a generic period-end phrasing without a period label", () => {
    expect(getInProcessBalanceNote()).toContain("the period end");
  });

  it("carries no internal tracker reference", () => {
    expect(getInProcessBalanceNote("June 2026")).not.toContain("#618");
  });

  it("returns null when nothing was exempt, so callers can omit the line", () => {
    expect(formatIdentityExemptionDisclosure([])).toBeNull();
    const allChecked = [
      makeRow({ ttb_tax_class: "keg" }),
      makeRow({ ttb_tax_class: "bottled" }),
    ];
    expect(getReportExemptionDisclosure(allChecked)).toBeNull();
  });

  it("lists each exempt class with its reason", () => {
    const disclosure = getReportExemptionDisclosure([makeCellarRow(), makeRow()]);
    expect(disclosure).toContain("Not accounting-identity checked:");
    expect(disclosure).toContain("Cellar (In-Process)");
    expect(disclosure).toContain("beer-in-process line");
    // Only the exempt class is named — the keg row was checked.
    expect(disclosure).not.toContain("Kegs");
    expect(disclosure).not.toContain("#618");
  });
});
