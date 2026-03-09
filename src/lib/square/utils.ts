/**
 * Square integration utility functions.
 *
 * Pure helpers extracted for testability from pricing.ts and the webhook route.
 */

/** Standard pour size in fluid ounces for draft sales. */
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
 * Each unit sold is assumed to be one standard pour (16 oz).
 */
export function calculateVolumeOz(quantity: number): number {
  return quantity * STANDARD_POUR_OZ;
}
