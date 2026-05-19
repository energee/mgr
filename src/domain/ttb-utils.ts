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

/** Convert barrels to gallons using the TTB standard (1 BBL = 31 gal). */
export function bblToGallons(bbl: number): number {
  return bbl * GALLONS_PER_BARREL;
}

/** Convert gallons to barrels using the TTB standard (1 BBL = 31 gal). */
export function gallonsToBbl(gallons: number): number {
  return gallons / GALLONS_PER_BARREL;
}

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
 */
export function validateEndingInventory(row: TTBReportRow): boolean {
  const expected = (row.total_available_bbl || 0) - (row.total_removals_bbl || 0);
  return Math.abs((row.ending_inventory_bbl || 0) - expected) < 0.005;
}

/**
 * Calculate the volume of completed batches from an array of batch records.
 * Sums volume_bbl, treating null volumes as zero.
 */
export function sumBatchVolumes(
  batches: { volume_bbl: number | null }[]
): number {
  return batches.reduce((sum, b) => sum + (b.volume_bbl || 0), 0);
}
