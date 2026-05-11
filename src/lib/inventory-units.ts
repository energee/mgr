/**
 * Inventory unit helpers.
 *
 * Centralizes the distinction between **whole-unit** materials (counted in
 * discrete pieces — trays, lids, quadpacks) and **bulk** materials (measured
 * by mass or volume — grains, hops, water, gas). The BOM editor and the
 * session-materials preview both branch on this to render integer math vs.
 * fractional math.
 *
 * No persisted "is_whole_unit" flag exists — the classification is derived
 * from `inventory_items.unit`. See WHOLE_UNIT_VALUES for the membership rule.
 */

/** Unit codes that represent discrete countable items. */
export const WHOLE_UNIT_VALUES = new Set(["each", "case"]);

/**
 * Returns true when the given unit code denotes a whole/discrete item.
 * Whole-unit materials must always resolve to integer quantities in
 * planning views; fractional consumption is meaningless.
 */
export function isWholeUnit(unit: string | null | undefined): boolean {
  if (!unit) return false;
  return WHOLE_UNIT_VALUES.has(unit);
}

/**
 * Best-effort recovery of a clean integer ratio (numerator/denominator) that
 * approximates the given decimal within `tolerance`, with denominator capped
 * at `maxDen`. Returns `null` if no such ratio fits — the caller should fall
 * back to displaying the raw decimal.
 *
 * Used by the BOM editor to render "X per Y" inputs when the stored decimal
 * is a clean ratio (1/4, 1/24, 2/1, …), and degrade gracefully otherwise.
 *
 * Scans 1..maxDen denominators and picks the smallest denominator whose
 * rounded numerator/denominator falls within tolerance.
 */
export function ratioFromDecimal(
  v: number,
  opts?: { maxDen?: number; tolerance?: number },
): { numerator: number; denominator: number } | null {
  if (!Number.isFinite(v) || v <= 0) return null;
  const maxDen = opts?.maxDen ?? 100;
  const tolerance = opts?.tolerance ?? 0.0005;

  for (let den = 1; den <= maxDen; den++) {
    const num = Math.round(v * den);
    if (num < 1) continue;
    if (Math.abs(num / den - v) <= tolerance) {
      return { numerator: num, denominator: den };
    }
  }
  return null;
}

/**
 * Per-line-item integer requirement for a whole-unit material.
 *
 * - When the BOM ratio is >= 1 (e.g., "2 lids per can"), we treat the stored
 *   value as a count and multiply by planned quantity.
 * - When the BOM ratio is < 1 (e.g., "1 tray per 24 cans"), we multiply
 *   straight through and ceil — sufficient at the per-line level. Aggregate
 *   precision drift across many lines is handled at render time by ceiling
 *   the summed total again.
 *
 * Note: callers aggregating across multiple BOM rows should sum the raw
 * decimal `quantity_per_unit * planned_quantity` first, then `Math.ceil`
 * the total. This function is for single-line previews only.
 */
export function computeWholeUnitRequired(qpu: number, planned: number): number {
  if (!Number.isFinite(qpu) || !Number.isFinite(planned)) return 0;
  if (qpu <= 0 || planned <= 0) return 0;
  if (qpu >= 1) return Math.round(qpu) * planned;
  return Math.ceil(planned * qpu);
}
