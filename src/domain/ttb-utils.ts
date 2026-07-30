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
 * Aggregate TTB report rows into a single totals object.
 * Sums each numeric column across all tax classes.
 */
export function calculateTotals(rows: TTBReportRow[]): TTBTotals {
  return rows.reduce(
    (acc, row) => ({
      beginningInventory: acc.beginningInventory + (row.beginning_inventory_bbl || 0),
      beerProduced: acc.beerProduced + (row.beer_produced_bbl || 0),
      totalAvailable: acc.totalAvailable + (row.total_available_bbl || 0),
      taxpaidDomestic: acc.taxpaidDomestic + (row.taxpaid_domestic_bbl || 0),
      taxpaidExport: acc.taxpaidExport + (row.taxpaid_export_bbl || 0),
      taxFreeSamples: acc.taxFreeSamples + (row.tax_free_samples_bbl || 0),
      losses: acc.losses + (row.losses_bbl || 0),
      destroyed: acc.destroyed + (row.destroyed_bbl || 0),
      totalRemovals: acc.totalRemovals + (row.total_removals_bbl || 0),
      endingInventory: acc.endingInventory + (row.ending_inventory_bbl || 0),
      inProcessEnding: acc.inProcessEnding + (row.in_process_ending_bbl || 0),
    }),
    { ...EMPTY_TOTALS }
  );
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
 * Tax classes whose TTB accounting identities the report can actually verify.
 *
 * `get_ttb_tax_class` (migration 00041) only ever returns 'keg' or 'bottled',
 * so no finished good is ever grouped under 'cellar'. The cellar row therefore
 * gets `ending_inventory_bbl` = 0 structurally, while `total_available_bbl` is
 * non-zero whenever anything was brewed in the period (get_ttb_report takes
 * cellar's produced volume from the production summary's batch term, 00041) and
 * `total_removals_bbl` is non-zero whenever a cellar loss/sample was booked
 * (batch-sourced removals, migration 00274). The cellar row's real balance
 * lives in `in_process_beginning_bbl` / `in_process_ending_bbl`, columns that
 * appear in neither identity. So `ending = available − removals` cannot hold
 * for cellar: applying it fails on essentially every month an active brewery
 * has — a chronic false alarm that trains the reader to ignore the one signal
 * that would catch a real arithmetic break in the keg/bottled rows.
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
 * either: once the cellar row carries real period-keyed balances, move
 * 'cellar' into this list.
 */
export const IDENTITY_CHECKED_TAX_CLASSES = ["keg", "bottled"] as const;

/** A tax class the Form 5130.9 accounting identities can be applied to. */
export type IdentityCheckedTaxClass = (typeof IDENTITY_CHECKED_TAX_CLASSES)[number];

/** Why the identities cannot be applied to a given tax class. */
const IDENTITY_EXEMPTION_REASONS: Record<string, string> = {
  cellar:
    "cellar volume is reported in the in-process columns as a current snapshot, so its ending inventory is structurally 0 (issue #618)",
};

/** Fallback reason for a tax class that is neither checked nor known-exempt. */
const UNKNOWN_TAX_CLASS_EXEMPTION_REASON =
  "not a finished-goods tax class the Form 5130.9 accounting identities apply to";

/** True when the Form 5130.9 accounting identities can be applied to this tax class. */
export function isIdentityCheckedTaxClass(
  taxClass: string
): taxClass is IdentityCheckedTaxClass {
  return (IDENTITY_CHECKED_TAX_CLASSES as readonly string[]).includes(taxClass);
}

/**
 * Reason the identity checks skip this tax class, or `null` when it is checked.
 * Exists so callers (and readers) can distinguish "checked and balanced" from
 * "not checkable" instead of silently treating the latter as a pass.
 */
export function getIdentityExemptionReason(taxClass: string): string | null {
  if (isIdentityCheckedTaxClass(taxClass)) return null;
  return IDENTITY_EXEMPTION_REASONS[taxClass] ?? UNKNOWN_TAX_CLASS_EXEMPTION_REASON;
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
 * Run both Form 5130.9 accounting identities against one report row, scoped to
 * the tax classes they can actually verify (see IDENTITY_CHECKED_TAX_CLASSES).
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
