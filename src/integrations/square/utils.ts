/**
 * Square integration utility functions.
 *
 * Pure helpers extracted for testability from pricing.ts and the webhook route.
 */

/**
 * Standard pour size in fluid ounces for draft sales — the documented DEFAULT,
 * used when a catalog mapping carries no per-variation pour size
 * (square_catalog_map.pour_size_oz, 00243 — NULL means "16 oz pour").
 */
export const STANDARD_POUR_OZ = 16;

/**
 * Convert a dollar amount to cents, rounding to avoid floating-point errors.
 *
 * @example dollarsToCents(10.13) // => 1013, not 1012.9999...
 */
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/**
 * Calculate the total volume in fluid ounces for a draft sale.
 *
 * Each unit sold is one pour of `pourSizeOz` fluid ounces — the variation's
 * square_catalog_map.pour_size_oz (audit BD-3) when set, otherwise the
 * STANDARD_POUR_OZ default (16 oz).
 */
export function calculateVolumeOz(quantity: number, pourSizeOz?: number | null): number {
  return quantity * (pourSizeOz ?? STANDARD_POUR_OZ);
}
