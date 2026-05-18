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

