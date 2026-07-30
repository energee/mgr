/**
 * TTB Report Utility Functions
 *
 * Pure functions for TTB Form 5130.9 data transformation and formatting.
 * Extracted from the TTB report page component and report-export module
 * so they can be unit tested independently.
 *
 * Key regulatory constants:
 * - 1 BBL (barrel) = 31 US gallons per TTB regulations
 * - Tax classes: cellar (in-process), keg, bottled (canned/bottled)
 */

import { formatDecimal } from "@/lib/format";

// =============================================================================
// Constants
// =============================================================================

/** US gallons per barrel, per TTB regulations. */
export const GALLONS_PER_BARREL = 31;

/** Month names used for TTB report period display. */
export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

// =============================================================================
// Conversion Functions
// =============================================================================

// =============================================================================
// Formatting Functions
// =============================================================================

/**
 * TTB compliance formatter: null/undefined volumes display as "0.00" (not "--").
 * On federal regulatory forms, blank/null volumes must appear as zero.
 */
export function formatTtbBbl(value: number | null | undefined): string {
  return formatDecimal(value ?? 0);
}

// =============================================================================
// Tax Class Functions
// =============================================================================

/**
 * Map TTB tax class code to its human-readable label.
 * Tax classes correspond to TTB Form 5130.9 columns:
 *   - cellar -> Column A (Cellar/In-Process)
 *   - keg -> Column C (Kegs)
 *   - bottled -> Column F (Canned/Bottled)
 * Unknown codes pass through unchanged.
 */
const TAX_CLASS_LABELS: Record<string, string> = {
  cellar: "Cellar (In-Process)",
  keg: "Kegs",
  bottled: "Canned/Bottled",
};

export function getTaxClassLabel(taxClass: string): string {
  return TAX_CLASS_LABELS[taxClass] ?? taxClass;
}

/**
 * Label for the in-process (cellar) volume line, shared by the report page, the
 * CSV export, and the print view. Deliberately says "current snapshot" rather
 * than "end of month": the underlying figure is a live sum of batches that are
 * *right now* fermenting/conditioning/packaging, with no period filter, so it is
 * not a period-end balance and re-running a closed month can change it
 * (issue #618).
 */
export const IN_PROCESS_SNAPSHOT_LABEL = "In Process (Current Snapshot)";

/**
 * The prose caveat that must accompany the in-process figures wherever they are
 * shown: the report page (both the `get_ttb_report` table and the legacy
 * fallback summary), the CSV export, and the print view. Single source of
 * wording so no surface can carry the honest label without the honest
 * explanation.
 *
 * @param periodLabel Human period the report covers, e.g. `"June 2026"`.
 *   Omit for a generic "the period end" (used where the period is already in
 *   the document heading).
 */
export function getInProcessSnapshotCaveat(periodLabel?: string): string {
  const asOf = periodLabel ? `the end of ${periodLabel}` : "the period end";
  return (
    "In-process figures are a snapshot of batches that are fermenting, " +
    `conditioning, or packaging right now — not a balance as of ${asOf}. ` +
    "Re-running a past period can return a different in-process number as " +
    "batches move on, so record the cellar figures you file."
  );
}

// =============================================================================
// Report Period Functions
// =============================================================================

/**
 * Generate year options for the period selector.
 * Returns current year and 3 years back (4 total).
 */
export function getYearOptions(currentYear?: number): number[] {
  const year = currentYear ?? new Date().getFullYear();
  return Array.from({ length: 4 }, (_, i) => year - i);
}

// =============================================================================
// Totals Calculation
// =============================================================================

/** Shape of the totals object produced by aggregating TTB report rows. */
export type TTBTotals = {
  beginningInventory: number;
  beerProduced: number;
  totalAvailable: number;
  taxpaidDomestic: number;
  taxpaidExport: number;
  taxFreeSamples: number;
  losses: number;
  destroyed: number;
  totalRemovals: number;
  endingInventory: number;
  inProcessEnding: number;
}

/** Row shape returned by the get_ttb_report database function. */
export type TTBReportRow = {
  report_year: number;
  report_month: number;
  report_period: string;
  ttb_tax_class: string;
  beginning_inventory_bbl: number;
  beer_produced_bbl: number;
  beer_received_bbl: number;
  total_available_bbl: number;
  taxpaid_domestic_bbl: number;
  taxpaid_export_bbl: number;
  tax_free_samples_bbl: number;
  losses_bbl: number;
  destroyed_bbl: number;
  adjustments_bbl: number;
  total_removals_bbl: number;
  ending_inventory_bbl: number;
  in_process_beginning_bbl: number;
  in_process_ending_bbl: number;
}

/**
 * A volume column of a TTB report row. Every numeric column on the report is a
 * barrel figure and its name ends in `_bbl`, so the suffix is the type.
 */
export type TTBVolumeField = Extract<keyof TTBReportRow, `${string}_bbl`>;

/** Zero-valued totals, used as the initial accumulator and fallback. */
export const EMPTY_TOTALS: TTBTotals = {
  beginningInventory: 0,
  beerProduced: 0,
  totalAvailable: 0,
  taxpaidDomestic: 0,
  taxpaidExport: 0,
  taxFreeSamples: 0,
  losses: 0,
  destroyed: 0,
  totalRemovals: 0,
  endingInventory: 0,
  inProcessEnding: 0,
};

/**
 * Aggregate TTB report rows into a single totals object — the report's Total
 * column and the summary figures above it.
 *
 * Every column is summed with `totalForColumn`, which decides per column which
 * rows may legitimately be added (see `TOTAL_SCOPE_BY_COLUMN`): the Part I
 * inventory/production columns cover the identity-checked tax classes only, the
 * Part II removals and the in-process columns cover every row. Do not reduce
 * over the rows directly — that adds the cellar row's *brewed* volume to the
 * keg/bottled rows' *packaged* volume and counts the same beer twice
 * (issue #670).
 */
export function calculateTotals(rows: TTBReportRow[]): TTBTotals {
  return {
    beginningInventory: totalForColumn(rows, "beginning_inventory_bbl"),
    beerProduced: totalForColumn(rows, "beer_produced_bbl"),
    totalAvailable: totalForColumn(rows, "total_available_bbl"),
    taxpaidDomestic: totalForColumn(rows, "taxpaid_domestic_bbl"),
    taxpaidExport: totalForColumn(rows, "taxpaid_export_bbl"),
    taxFreeSamples: totalForColumn(rows, "tax_free_samples_bbl"),
    losses: totalForColumn(rows, "losses_bbl"),
    destroyed: totalForColumn(rows, "destroyed_bbl"),
    totalRemovals: totalForColumn(rows, "total_removals_bbl"),
    endingInventory: totalForColumn(rows, "ending_inventory_bbl"),
    inProcessEnding: totalForColumn(rows, "in_process_ending_bbl"),
  };
}

/**
 * Validate that total_available = beginning_inventory + beer_produced + beer_received
 * for a single TTB report row. Returns true if the accounting identity holds.
 *
 * Raw arithmetic only: this says nothing about whether the identity *applies*
 * to the row's tax class. Callers must gate on `isIdentityCheckedTaxClass`
 * (or use `checkRowIdentities`, which does the gating for them).
 */
export function validateRowBalance(row: TTBReportRow): boolean {
  const expected =
    (row.beginning_inventory_bbl || 0) +
    (row.beer_produced_bbl || 0) +
    (row.beer_received_bbl || 0);
  return Math.abs((row.total_available_bbl || 0) - expected) < 0.005;
}

/**
 * Validate that ending_inventory = total_available - total_removals
 * for a single TTB report row. Returns true if the accounting identity holds.
 *
 * Raw arithmetic only — same caveat as `validateRowBalance`: it must not be
 * applied to the cellar row, whose volume lives in the in-process columns
 * rather than in `ending_inventory_bbl`. See `checkRowIdentities`.
 */
export function validateEndingInventory(row: TTBReportRow): boolean {
  const expected = (row.total_available_bbl || 0) - (row.total_removals_bbl || 0);
  return Math.abs((row.ending_inventory_bbl || 0) - expected) < 0.005;
}

// =============================================================================
// Identity-Check Scoping (which tax classes the identities apply to)
// =============================================================================

/**
 * The tax classes exempt from the TTB accounting identities — an enumerated
 * exemption list, not a list of checked classes. Everything not named here is
 * checked, which is the safe direction: a tax class nobody has thought about
 * yet gets verified (and shouts if the arithmetic breaks) rather than being
 * silently excused. If a later migration adds a finished-goods class — a
 * barrel-aged or cider arm — the identities apply to it from its first report,
 * and a non-balancing row raises the loud "review before filing" alert instead
 * of a quiet "not checked" footnote.
 *
 * Why 'cellar' is on the list: `get_ttb_tax_class` (migration 00041) only ever
 * returns 'keg' or 'bottled', so no finished good is ever grouped under
 * 'cellar'. The cellar row therefore gets `ending_inventory_bbl` = 0
 * structurally, while `total_available_bbl` is non-zero whenever anything was
 * brewed in the period (get_ttb_report takes cellar's produced volume from the
 * production summary's batch term, 00041) and `total_removals_bbl` is non-zero
 * whenever a cellar loss/sample was booked (batch-sourced removals, migration
 * 00274). The cellar row's real balance lives in `in_process_beginning_bbl` /
 * `in_process_ending_bbl`, columns that appear in neither identity. So
 * `ending = available − removals` cannot hold for cellar: applying it fails on
 * essentially every month an active brewery has — a chronic false alarm that
 * trains the reader to ignore the one signal that would catch a real arithmetic
 * break in the keg/bottled rows.
 *
 * KNOWN LIMITATION (issue #618): the in-process terms are a *live status
 * snapshot*, not period-keyed history — `ip_ending` (migration 00237) sums
 * `batches.volume_bbl` for every batch currently in fermenting/conditioning/
 * packaging with no date filter at all, so re-running a closed month returns a
 * different number every time a batch changes status. Closed months are not
 * reproducible. Exempting cellar from the identity checks removes the false
 * alarm; it does not fix the snapshot-vs-history defect. Options 1/2 in #618
 * (derive history from `entity_revisions`, or add status-transition timestamp
 * columns) remain the durable fix, and this scoping is forward-compatible with
 * either: once the cellar row carries real period-keyed balances, drop 'cellar'
 * from this list and it becomes checked like every other class.
 */
export const IDENTITY_EXEMPT_TAX_CLASSES = ["cellar"] as const;

/** A tax class the Form 5130.9 accounting identities cannot be applied to. */
export type IdentityExemptTaxClass = (typeof IDENTITY_EXEMPT_TAX_CLASSES)[number];

/**
 * Why the identities cannot be applied to each exempt tax class.
 *
 * User-facing copy: this text is rendered on the filing-prep screen and in the
 * CSV/print exports, so it carries no internal tracker references. The issue
 * numbers behind it live in the `IDENTITY_EXEMPT_TAX_CLASSES` docblock above
 * (#618 for the snapshot-vs-history defect), where a developer will find them.
 */
const IDENTITY_EXEMPTION_REASONS: Record<IdentityExemptTaxClass, string> = {
  cellar:
    "cellar volume is reported in the in-process columns as a current snapshot, so its ending inventory is structurally 0",
};

/** True when this tax class is on the enumerated identity-exemption list. */
function isIdentityExemptTaxClass(taxClass: string): taxClass is IdentityExemptTaxClass {
  return (IDENTITY_EXEMPT_TAX_CLASSES as readonly string[]).includes(taxClass);
}

/**
 * True when the Form 5130.9 accounting identities can be applied to this tax
 * class — i.e. for everything except the enumerated exemptions. Unknown classes
 * are checked, deliberately: see `IDENTITY_EXEMPT_TAX_CLASSES`.
 */
export function isIdentityCheckedTaxClass(taxClass: string): boolean {
  return !isIdentityExemptTaxClass(taxClass);
}

/**
 * Reason the identity checks skip this tax class, or `null` when it is checked.
 * Exists so callers (and readers) can distinguish "checked and balanced" from
 * "not checkable" instead of silently treating the latter as a pass.
 */
export function getIdentityExemptionReason(taxClass: string): string | null {
  return isIdentityExemptTaxClass(taxClass) ? IDENTITY_EXEMPTION_REASONS[taxClass] : null;
}

/**
 * Outcome of the accounting-identity checks for one TTB report row.
 * `"exempt"` means the identities do not apply to this tax class at all —
 * deliberately distinct from `"checked"` with no failures.
 */
export type TTBIdentityCheck =
  | { taxClass: string; label: string; status: "exempt"; reason: string }
  | { taxClass: string; label: string; status: "checked"; failures: string[] };

/** The "not checkable" arm of TTBIdentityCheck. */
export type TTBIdentityExemption = Extract<TTBIdentityCheck, { status: "exempt" }>;

/**
 * Run both Form 5130.9 accounting identities against one report row, skipping
 * the classes they cannot verify (see IDENTITY_EXEMPT_TAX_CLASSES).
 * Failure strings are display-ready; the cellar row comes back as `"exempt"`.
 */
export function checkRowIdentities(row: TTBReportRow): TTBIdentityCheck {
  const label = getTaxClassLabel(row.ttb_tax_class);
  const exemptionReason = getIdentityExemptionReason(row.ttb_tax_class);
  if (exemptionReason !== null) {
    return { taxClass: row.ttb_tax_class, label, status: "exempt", reason: exemptionReason };
  }

  const failures: string[] = [];
  if (!validateRowBalance(row)) {
    failures.push(
      `${label}: total available (${formatTtbBbl(row.total_available_bbl)}) ≠ beginning inventory + beer produced + beer received`
    );
  }
  if (!validateEndingInventory(row)) {
    failures.push(
      `${label}: ending inventory (${formatTtbBbl(row.ending_inventory_bbl)}) ≠ total available − total removals`
    );
  }
  return { taxClass: row.ttb_tax_class, label, status: "checked", failures };
}

/**
 * Flatten identity-check results into the display-ready failure list shown to
 * the compliance officer. Exempt rows contribute nothing — they are surfaced
 * separately as "not checked", never folded in as passes.
 */
export function collectIdentityFailures(checks: TTBIdentityCheck[]): string[] {
  return checks.flatMap((check) => (check.status === "checked" ? check.failures : []));
}

/**
 * The rows whose identities could not be checked, so the report can disclose
 * "not checked" explicitly instead of letting a reader assume they balanced.
 */
export function collectIdentityExemptions(checks: TTBIdentityCheck[]): TTBIdentityExemption[] {
  return checks.filter((check): check is TTBIdentityExemption => check.status === "exempt");
}

/**
 * The "not checked" disclosure sentence, shared by the report page, the CSV
 * export and the print view so every copy of the report discloses the same
 * thing. Returns `null` when every class in the report was checked, so callers
 * can omit the line entirely rather than print an empty disclosure.
 */
export function formatIdentityExemptionDisclosure(
  exemptions: TTBIdentityExemption[]
): string | null {
  if (exemptions.length === 0) return null;
  const list = exemptions.map((check) => `${check.label} (${check.reason})`).join("; ");
  return `Not accounting-identity checked: ${list}.`;
}

/**
 * Convenience wrapper: the disclosure sentence for a whole report, or `null`
 * when nothing in it was exempt. Used by the CSV and print exports, which have
 * the raw rows rather than pre-computed checks.
 */
export function getReportExemptionDisclosure(rows: TTBReportRow[]): string | null {
  return formatIdentityExemptionDisclosure(collectIdentityExemptions(rows.map(checkRowIdentities)));
}

// =============================================================================
// Total Column Scoping (which rows a column's Total may add)
// =============================================================================

/** Heading of the report's Total column on all three surfaces. */
export const TOTAL_COLUMN_LABEL = "Total";

/**
 * Footnote marker appended to the Line Item label of a line whose Total covers
 * the packaged tax classes only (see `TOTAL_SCOPE_BY_COLUMN`). The marker sits
 * on the line rather than in the column heading because the scope is per line,
 * not per column: a single heading saying "finished goods" would be false for
 * the Part II removals lines, which do total every class.
 *
 * `getTotalScopeCaveat` opens with the same marker, so screen, CSV and print
 * all pair the mark with its explanation.
 */
export const PACKAGED_TOTAL_MARKER = "†";

/**
 * Which rows a column's Total may add.
 *
 * - `"packaged-only"` — the identity-checked (packaged) tax classes only. The
 *   exempt classes' cells on this column are a different measurement, so adding
 *   them counts the same beer twice.
 * - `"all-classes"` — every row. Each cell is the same measurement whatever the
 *   tax class, so every barrel is counted exactly once.
 */
export type TTBTotalScope = "packaged-only" | "all-classes";

/**
 * Total scope for every volume column of the report, decided per column on what
 * the cells actually measure (issue #670).
 *
 * Typed as a total `Record` over `TTBVolumeField` on purpose: adding a `_bbl`
 * column to `TTBReportRow` fails to compile until someone classifies it, so a
 * new column cannot silently inherit a scope that is wrong for it.
 *
 * **Part I — `"packaged-only"`.** `get_ttb_tax_class` (migration 00041) never
 * classes a finished good as 'cellar', so `get_ttb_report` composes the cellar
 * row's Part I differently from the packaged rows:
 *   - `beer_produced_bbl` on the cellar row is beer *brewed* in the period
 *     (00041 takes it from the production summary's batch term); on the keg and
 *     canned/bottled rows the same column is beer *packaged*. A batch brewed and
 *     kegged in June is in both, so a Total spanning all three reported roughly
 *     double the beer that existed. `total_available_bbl` is `beginning +
 *     produced` and inherits the mixing; `beer_received_bbl` is the third addend
 *     of that identity and is scoped with it (it is hardcoded 0 upstream today,
 *     so the choice is currently inert).
 *   - `beginning_inventory_bbl` / `ending_inventory_bbl` come from
 *     `fg_beginning` / `fg_ending` (migration 00237), which group by
 *     `get_ttb_tax_class(c.type)` and therefore never produce a cellar bucket.
 *     The cellar row's cells are structurally 0, and the cellar's real balance
 *     is carried on the beer-in-process line. Scoping these by tax class rather
 *     than trusting the zeros is what keeps the Total right if a later migration
 *     ever puts a number there.
 * Scoping all five together also keeps the Total column's own
 * `available = beginning + produced + received` identity exact, because it holds
 * on each packaged row and the Total is a plain sum of those rows.
 *
 * **Part II removals — `"all-classes"`.** These are NOT double counted, and
 * excluding them would understate removals on a filing-prep figure. Migration
 * 00274 (issue #603) deliberately admitted batch-sourced cellar removals onto
 * Form 5130.9 and built them so they cannot overlap the packaged rows: it drops
 * every batch-sourced allocation whose `destination_type` is `finished_good`,
 * `transfer` or `batch` — "Packaging: leaves the cellar via the
 * production/packaging terms", "Counting them here would debit the cellar
 * twice". What survives is beer that left the brewery from the cellar (a loss, a
 * destruction, a sample, a taproom pour) and that no packaged line ever reports.
 *
 * **In process — `"all-classes"`.** Only 'cellar' carries in-process volume
 * today (00237 attributes `ip_beginning`/`ip_ending` to 'cellar' alone), and a
 * class that ever did report it would be reporting the same measure: beer still
 * in a tank. Scoping this to packaged classes would report 0.00 beer in process
 * next to a non-zero cellar cell.
 *
 * KNOWN CONSEQUENCE (tracked as issue #698): mixing the two scopes down one
 * column means the Total column does not cross-foot. `ending = available −
 * removals` holds on each packaged row, but the Total's removals include the
 * cellar's, which draw down no packaged available — so `Total available −
 * Total removals` lands *below* Total ending inventory, by exactly the exempt
 * classes' removals. Worked from the parity fixture: available 185.00 −
 * removals 43.25 = 141.75, against ending inventory 143.25 — an excess of 1.50,
 * the cellar's `total_removals_bbl`. The direction is load-bearing: a reader
 * told ending inventory is "short" would go looking for missing beer that does
 * not exist. `getTotalScopeCaveat` states this on every surface.
 * The alternative (dropping cellar removals to make the column cross-foot)
 * understates real, non-duplicated removals, which is the worse error on a
 * federal filing-prep screen.
 */
const TOTAL_SCOPE_BY_COLUMN: Record<TTBVolumeField, TTBTotalScope> = {
  // Part I - operations (packaged stock and flow)
  beginning_inventory_bbl: "packaged-only",
  beer_produced_bbl: "packaged-only",
  beer_received_bbl: "packaged-only",
  total_available_bbl: "packaged-only",
  ending_inventory_bbl: "packaged-only",
  // Part II - disposition (brewery-wide; 00274 keeps cellar removals disjoint)
  taxpaid_domestic_bbl: "all-classes",
  taxpaid_export_bbl: "all-classes",
  tax_free_samples_bbl: "all-classes",
  losses_bbl: "all-classes",
  destroyed_bbl: "all-classes",
  adjustments_bbl: "all-classes",
  total_removals_bbl: "all-classes",
  // Beer in process (one measurement, one lifecycle stage)
  in_process_beginning_bbl: "all-classes",
  in_process_ending_bbl: "all-classes",
};

/** Which rows this column's Total may add. See `TOTAL_SCOPE_BY_COLUMN`. */
export function totalScopeFor(field: TTBVolumeField): TTBTotalScope {
  return TOTAL_SCOPE_BY_COLUMN[field];
}

/**
 * The Total for one column of the TTB report — the single source every surface
 * uses (the page's Total column and summary figures, the CSV export, and the
 * print view), so the three cannot drift apart.
 *
 * A `"packaged-only"` column sums the identity-checked tax classes only. The
 * excluded set is read from `IDENTITY_EXEMPT_TAX_CLASSES` — the same list that
 * scopes the accounting identities (issue #618), not a second list that could
 * drift from it: when the cellar row carries real period-keyed balances and
 * drops off that list, it becomes both checked and summable in one edit.
 *
 * An `"all-classes"` column sums every row. Which column is which, and why, is
 * in `TOTAL_SCOPE_BY_COLUMN`.
 */
export function totalForColumn(rows: readonly TTBReportRow[], field: TTBVolumeField): number {
  const packagedOnly = totalScopeFor(field) === "packaged-only";
  return rows.reduce((sum, row) => {
    if (packagedOnly && !isIdentityCheckedTaxClass(row.ttb_tax_class)) return sum;
    return sum + (row[field] || 0);
  }, 0);
}

/**
 * The exempt tax classes this report actually contains — the single gate on both
 * the line marker and the caveat, so a marked line always has a footnote to
 * explain it and a footnote never appears without a line to explain.
 */
function scopedOutClasses(rows: readonly TTBReportRow[]): IdentityExemptTaxClass[] {
  return IDENTITY_EXEMPT_TAX_CLASSES.filter((taxClass) =>
    rows.some((row) => row.ttb_tax_class === taxClass)
  );
}

/**
 * A report line's label, marked when that line's Total is packaged-only, so the
 * reader can tell the two scopes apart in the table itself rather than having to
 * map the footnote back onto the rows. Used by the screen, the CSV and the print
 * view so all three mark the same lines.
 *
 * Nothing is marked when the report holds no exempt class: there the two scopes
 * produce the same number, and a marker whose footnote says nothing was left out
 * is noise. Same gate as `getTotalScopeCaveat`.
 */
export function totalScopedLineLabel(
  rows: readonly TTBReportRow[],
  label: string,
  field: TTBVolumeField
): string {
  const marked = totalScopeFor(field) === "packaged-only" && scopedOutClasses(rows).length > 0;
  return marked ? `${label} ${PACKAGED_TOTAL_MARKER}` : label;
}

/**
 * Why each exempt tax class is left out of the packaged-only Totals.
 *
 * Per class, like `IDENTITY_EXEMPTION_REASONS`, so adding a second exempt class
 * produces copy that is true of it instead of repeating the cellar's reason.
 *
 * User-facing: no internal tracker references (they live on
 * `TOTAL_SCOPE_BY_COLUMN`, where a developer will find them).
 */
const PACKAGED_TOTAL_EXCLUSION_REASONS: Record<IdentityExemptTaxClass, string> = {
  cellar:
    "its produced and available volumes are beer brewed during the period, which the packaged lines report again once that beer is packaged, and its own balance is carried on the beer-in-process line instead",
};

/**
 * What the marked Totals cover, in prose, for someone transcribing these figures
 * onto Form 5130.9. Rendered under the report table on screen, as a trailing
 * NOTE row in the CSV, and as a footnote in the print view — one wording, so no
 * copy of the report is more confident than another.
 *
 * Returns `null` when the report contains no exempt class, in which case no line
 * is marked and there is nothing to explain. Both the class names and their
 * reasons are derived per class, so the sentence stays true if
 * `IDENTITY_EXEMPT_TAX_CLASSES` gains or loses a member.
 */
export function getTotalScopeCaveat(rows: readonly TTBReportRow[]): string | null {
  const excluded = scopedOutClasses(rows);
  if (excluded.length === 0) return null;

  const list = excluded
    .map((taxClass) => `${getTaxClassLabel(taxClass)} — ${PACKAGED_TOTAL_EXCLUSION_REASONS[taxClass]}`)
    .join("; ");
  return (
    `${PACKAGED_TOTAL_MARKER} ${TOTAL_COLUMN_LABEL} on the marked lines covers ` +
    `the packaged tax classes only. Left out: ${list}. Every other line totals ` +
    "all tax classes: a removal booked against beer " +
    "still in the cellar is beer that left the brewery and no packaged line " +
    "reports it again, and beer in process is one measurement at one stage. " +
    `One consequence: the ${TOTAL_COLUMN_LABEL} column does not cross-foot — ` +
    "available minus removals comes out below ending inventory, by exactly " +
    "those cellar removals, which draw down no packaged available. Ending " +
    "inventory is not short; the subtraction is."
  );
}

/**
 * What the four summary cards above the table cover, given the classes actually
 * in this report. Three of them are packaged-only totals and one (Total
 * Removals) is brewery-wide, so a single sentence under the grid is the only
 * place that distinction can be stated — the cards have no room for it.
 *
 * Returns `null` when nothing is excluded, and derives both lists from the rows
 * rather than naming classes literally.
 */
export function getSummaryCardScopeNote(rows: readonly TTBReportRow[]): string | null {
  const excluded = rows
    .filter((row) => !isIdentityCheckedTaxClass(row.ttb_tax_class))
    .map((row) => getTaxClassLabel(row.ttb_tax_class));
  if (excluded.length === 0) return null;

  const included = rows
    .filter((row) => isIdentityCheckedTaxClass(row.ttb_tax_class))
    .map((row) => getTaxClassLabel(row.ttb_tax_class));
  const includedList = included.length > 0 ? formatList(included) : "no tax class in this period";
  return (
    `Beginning Inventory, Beer Packaged and Ending Inventory cover the packaged ` +
    `tax classes (${includedList}); ${formatList(excluded)} is reported on the ` +
    "beer-in-process line below instead. Total Removals covers every tax class, " +
    "including removals booked against beer still in the cellar."
  );
}

/** `["a"] -> "a"`, `["a","b"] -> "a and b"`, `["a","b","c"] -> "a, b and c"`. */
function formatList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
