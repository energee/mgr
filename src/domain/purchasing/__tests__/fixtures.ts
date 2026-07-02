/**
 * Shared test fixture factories for purchasing domain tests.
 */

import type { IngredientShortfall } from "../demand-calculator";

/** Build an IngredientShortfall with sensible defaults, overridable per-field. */
export const makeShortfall = (
  overrides: Partial<IngredientShortfall> = {}
): IngredientShortfall => ({
  catalog_type: "malt",
  catalog_id: "id-1",
  catalog_name: "Pale Malt",
  total_required: 100,
  available_qty: 50,
  on_order_qty: 0,
  shortfall_qty: 50,
  unit: "lb",
  required_by_date: "2026-04-01",
  order_by_date: "2026-03-15",
  lead_time_days: 14,
  preferred_supplier_id: "supplier-1",
  preferred_supplier_name: "Supplier A",
  min_order_qty: null,
  unit_price: 1.5,
  is_urgent: false,
  batch_count: 1,
  ...overrides,
});
