/**
 * Inventory unit helpers.
 *
 * Centralizes the distinction between **whole-unit** materials (counted in
 * discrete pieces — trays, lids, quadpacks) and **bulk** materials (measured
 * by mass or volume — grains, hops, water, gas). The BOM editor and the
 * session-materials preview both branch on this to render integer math vs.
 * fractional math.
 *
 * Also owns the canonical inventory/purchasing unit option list
 * (INVENTORY_UNIT_OPTIONS) shared by inventory items, inventory lots, and
 * PO line items, plus alias-tolerant normalization helpers used to compare
 * units across those records (e.g. the PO accept-into-inventory mismatch
 * warning).
 *
 * No persisted "is_whole_unit" flag exists — the classification is derived
 * from `inventory_items.unit`. See WHOLE_UNIT_VALUES for the membership rule.
 */

// =============================================================================
// Canonical unit options (shared select list)
// =============================================================================

/**
 * The single unit option list for inventory items, inventory lots, and PO
 * line items. Historically each surface had its own divergent copy (the lot
 * form was missing "case" and PO lines were free text); keeping one list
 * means a unit chosen on a PO line is always representable on the lot and
 * item forms it flows into.
 *
 * Stored rows may still hold legacy free-text units (e.g. "sack") — render
 * surfaces should display such values rather than dropping them (see
 * po-line-items-editor.tsx), and comparisons should go through
 * unitsEquivalent() so aliases like "lbs" don't read as mismatches.
 */
export const INVENTORY_UNIT_OPTIONS: { value: string; label: string }[] = [
  { value: "lb", label: "Pounds (lb)" },
  { value: "oz", label: "Ounces (oz)" },
  { value: "kg", label: "Kilograms (kg)" },
  { value: "g", label: "Grams (g)" },
  { value: "each", label: "Each" },
  { value: "case", label: "Case" },
  { value: "gal", label: "Gallons" },
];

/**
 * Free-text aliases mapped to canonical INVENTORY_UNIT_OPTIONS values.
 * Covers the spellings that show up in legacy PO line / lot data.
 */
const INVENTORY_UNIT_ALIASES: Record<string, string> = {
  lbs: "lb",
  pound: "lb",
  pounds: "lb",
  ounce: "oz",
  ounces: "oz",
  kilogram: "kg",
  kilograms: "kg",
  gram: "g",
  grams: "g",
  ea: "each",
  cases: "case",
  gallon: "gal",
  gallons: "gal",
};

/**
 * Normalize a unit string for comparison: trim, lowercase, and collapse
 * known aliases to their canonical code ("Lbs" → "lb"). Unrecognized units
 * pass through lowercased so they still compare equal to themselves.
 */
export function normalizeInventoryUnit(
  unit: string | null | undefined,
): string {
  const trimmed = unit?.trim().toLowerCase() ?? "";
  return INVENTORY_UNIT_ALIASES[trimmed] ?? trimmed;
}

/**
 * Alias-tolerant unit equality ("lb" ≡ "Lbs", "each" ≡ "ea"). Returns false
 * when either side is empty — callers decide how to treat missing units.
 */
export function unitsEquivalent(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const normA = normalizeInventoryUnit(a);
  const normB = normalizeInventoryUnit(b);
  if (!normA || !normB) return false;
  return normA === normB;
}

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

