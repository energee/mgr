import { describe, it, expect } from "vitest";
import { groupShortfallsBySupplier } from "../po-generator";
import type { IngredientShortfall } from "../demand-calculator";

describe("groupShortfallsBySupplier", () => {
  const makeShortfall = (overrides: Partial<IngredientShortfall> = {}): IngredientShortfall => ({
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

  it("groups shortfalls by supplier", () => {
    const shortfalls = [
      makeShortfall(),
      makeShortfall({ catalog_id: "id-2", catalog_name: "Crystal 60", lead_time_days: 10 }),
    ];
    const result = groupShortfallsBySupplier(shortfalls);
    expect(result).toHaveLength(1);
    expect(result[0].supplier_id).toBe("supplier-1");
    expect(result[0].line_items).toHaveLength(2);
  });

  it("uses earliest order_by_date", () => {
    const shortfalls = [
      makeShortfall({ order_by_date: "2026-03-20" }),
      makeShortfall({ catalog_id: "id-2", order_by_date: "2026-03-10" }),
    ];
    const result = groupShortfallsBySupplier(shortfalls);
    expect(result[0].order_by_date).toBe("2026-03-10");
  });

  it("computes max_lead_time_days from line items", () => {
    const shortfalls = [
      makeShortfall({ lead_time_days: 14 }),
      makeShortfall({ catalog_id: "id-2", lead_time_days: 21 }),
    ];
    const result = groupShortfallsBySupplier(shortfalls);
    expect(result[0].max_lead_time_days).toBe(21);
  });

  it("uses minimum of 7 for max_lead_time_days", () => {
    const shortfalls = [makeShortfall({ lead_time_days: 3 })];
    const result = groupShortfallsBySupplier(shortfalls);
    expect(result[0].max_lead_time_days).toBe(7);
  });

  it("passes lead_time_days through to line items", () => {
    const shortfalls = [makeShortfall({ lead_time_days: 14 })];
    const result = groupShortfallsBySupplier(shortfalls);
    expect(result[0].line_items[0].lead_time_days).toBe(14);
  });

  it("skips shortfalls without preferred supplier", () => {
    const shortfalls = [makeShortfall({ preferred_supplier_id: null })];
    const result = groupShortfallsBySupplier(shortfalls);
    expect(result).toHaveLength(0);
  });
});
