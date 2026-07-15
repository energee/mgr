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

export type SquareDraftSaleInsert = {
  square_order_id: string;
  square_payment_id: string | null;
  brand_id: string;
  selling_format_id: string;
  quantity: number;
  volume_oz: number;
  unit_price_cents: number;
  location_id: string;
  sold_at: string;
};

type BuildSquareDraftSaleInsertInput = {
  orderId: string;
  paymentId: string | null;
  brandId: string;
  sellingFormatId: string;
  quantity: number;
  volumeOz: number;
  unitPriceCents: number;
  locationId: string;
  soldAt: string;
};

/**
 * Build the canonical database payload used to stage a Square draft pour.
 * Keeping this mapping shared lets the real-Postgres integration test execute
 * the exact webhook contract and prevents a retired packaging key from being
 * reintroduced at either boundary.
 */
export function buildSquareDraftSaleInsert(
  input: BuildSquareDraftSaleInsertInput,
): SquareDraftSaleInsert {
  return {
    square_order_id: input.orderId,
    square_payment_id: input.paymentId,
    brand_id: input.brandId,
    selling_format_id: input.sellingFormatId,
    quantity: input.quantity,
    volume_oz: input.volumeOz,
    unit_price_cents: input.unitPriceCents,
    location_id: input.locationId,
    sold_at: input.soldAt,
  };
}

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
