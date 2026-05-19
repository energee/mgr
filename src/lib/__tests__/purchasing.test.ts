/**
 * Purchasing utility tests
 *
 * Comprehensive tests for pure functions in the purchasing module:
 * - po-generator: groupShortfallsBySupplier
 * - demand-calculator: getCatalogTypeDisplay, formatQuantityWithUnit
 * - landed-cost: formatLandedCost, landedCostMarkup
 */

import { describe, it, expect } from "vitest";
import { groupShortfallsBySupplier } from "@/domain/purchasing/po-generator";
import {
  getCatalogTypeDisplay,
  formatQuantityWithUnit,
} from "@/domain/purchasing/demand-calculator";
import type { IngredientShortfall } from "@/domain/purchasing/demand-calculator";
import {
  formatLandedCost,
  landedCostMarkup,
} from "@/domain/purchasing/landed-cost";

// =============================================================================
// Test Data Helpers
// =============================================================================

/** Build an IngredientShortfall with sensible defaults, overridable per-field. */
function makeShortfall(
  overrides: Partial<IngredientShortfall> = {}
): IngredientShortfall {
  return {
    catalog_type: "malt",
    catalog_id: "cat-001",
    catalog_name: "Pale Malt",
    total_required: 100,
    available_qty: 40,
    on_order_qty: 0,
    shortfall_qty: 60,
    unit: "lbs",
    required_by_date: "2026-04-01",
    order_by_date: "2026-03-15",
    lead_time_days: 7,
    preferred_supplier_id: "sup-001",
    preferred_supplier_name: "Acme Malt Co",
    min_order_qty: null,
    unit_price: 1.5,
    is_urgent: false,
    batch_count: 2,
    ...overrides,
  };
}

// =============================================================================
// groupShortfallsBySupplier
// =============================================================================

describe("groupShortfallsBySupplier", () => {
  it("returns empty array for empty shortfalls", () => {
    const result = groupShortfallsBySupplier([]);
    expect(result).toEqual([]);
  });

  it("handles a single shortfall", () => {
    const shortfall = makeShortfall();
    const result = groupShortfallsBySupplier([shortfall]);

    expect(result).toHaveLength(1);
    expect(result[0].supplier_id).toBe("sup-001");
    expect(result[0].supplier_name).toBe("Acme Malt Co");
    expect(result[0].line_items).toHaveLength(1);
    expect(result[0].item_count).toBe(1);
  });

  it("groups multiple items from the same supplier together", () => {
    const shortfalls = [
      makeShortfall({
        catalog_id: "cat-001",
        catalog_name: "Pale Malt",
        shortfall_qty: 60,
        unit_price: 1.5,
      }),
      makeShortfall({
        catalog_id: "cat-002",
        catalog_name: "Munich Malt",
        shortfall_qty: 30,
        unit_price: 2.0,
      }),
    ];

    const result = groupShortfallsBySupplier(shortfalls);

    expect(result).toHaveLength(1);
    expect(result[0].line_items).toHaveLength(2);
    expect(result[0].item_count).toBe(2);
  });

  it("separates items from different suppliers into distinct groups", () => {
    const shortfalls = [
      makeShortfall({
        preferred_supplier_id: "sup-001",
        preferred_supplier_name: "Acme Malt Co",
      }),
      makeShortfall({
        preferred_supplier_id: "sup-002",
        preferred_supplier_name: "Best Hops Inc",
        catalog_type: "hop",
        catalog_id: "cat-003",
        catalog_name: "Cascade",
      }),
    ];

    const result = groupShortfallsBySupplier(shortfalls);

    expect(result).toHaveLength(2);
    const supplierIds = result.map((g) => g.supplier_id).sort();
    expect(supplierIds).toEqual(["sup-001", "sup-002"]);
  });

  it("skips items without a preferred supplier (null supplier_id)", () => {
    const shortfalls = [
      makeShortfall({ preferred_supplier_id: null, preferred_supplier_name: null }),
      makeShortfall({ preferred_supplier_id: "sup-001" }),
    ];

    const result = groupShortfallsBySupplier(shortfalls);

    expect(result).toHaveLength(1);
    expect(result[0].supplier_id).toBe("sup-001");
  });

  it("returns empty array when all shortfalls lack a supplier", () => {
    const shortfalls = [
      makeShortfall({ preferred_supplier_id: null }),
      makeShortfall({ preferred_supplier_id: null }),
    ];

    const result = groupShortfallsBySupplier(shortfalls);
    expect(result).toEqual([]);
  });

  it("picks the earliest order_by_date per supplier group", () => {
    const shortfalls = [
      makeShortfall({
        catalog_id: "cat-001",
        order_by_date: "2026-03-20",
      }),
      makeShortfall({
        catalog_id: "cat-002",
        order_by_date: "2026-03-10",
      }),
      makeShortfall({
        catalog_id: "cat-003",
        order_by_date: "2026-03-25",
      }),
    ];

    const result = groupShortfallsBySupplier(shortfalls);

    expect(result).toHaveLength(1);
    expect(result[0].order_by_date).toBe("2026-03-10");
  });

  it("calculates estimated_total as sum of quantity * unit_price per line item", () => {
    const shortfalls = [
      makeShortfall({
        catalog_id: "cat-001",
        shortfall_qty: 60,
        unit_price: 1.5,
        min_order_qty: null,
      }),
      makeShortfall({
        catalog_id: "cat-002",
        shortfall_qty: 30,
        unit_price: 2.0,
        min_order_qty: null,
      }),
    ];

    const result = groupShortfallsBySupplier(shortfalls);

    // 60 * 1.5 = 90, 30 * 2.0 = 60 => total 150
    expect(result[0].estimated_total).toBe(150);
  });

  it("uses null estimated_total for items with null unit_price", () => {
    const shortfalls = [
      makeShortfall({
        shortfall_qty: 60,
        unit_price: null,
      }),
    ];

    const result = groupShortfallsBySupplier(shortfalls);

    expect(result[0].line_items[0].estimated_total).toBeNull();
    // Null estimated_total treated as 0 in group sum
    expect(result[0].estimated_total).toBe(0);
  });

  it("respects minimum_order_qty when present", () => {
    const shortfalls = [
      makeShortfall({
        shortfall_qty: 10,
        min_order_qty: 50,
        unit_price: 2.0,
      }),
    ];

    const result = groupShortfallsBySupplier(shortfalls);
    const lineItem = result[0].line_items[0];

    // Order qty should be max(10, 50) = 50
    expect(lineItem.quantity).toBe(50);
    expect(lineItem.shortfall_qty).toBe(10);
    expect(lineItem.min_order_qty).toBe(50);
    // estimated_total = 50 * 2.0 = 100
    expect(lineItem.estimated_total).toBe(100);
  });

  it("uses shortfall_qty when it exceeds min_order_qty", () => {
    const shortfalls = [
      makeShortfall({
        shortfall_qty: 100,
        min_order_qty: 50,
        unit_price: 1.0,
      }),
    ];

    const result = groupShortfallsBySupplier(shortfalls);
    const lineItem = result[0].line_items[0];

    // Order qty should be max(100, 50) = 100
    expect(lineItem.quantity).toBe(100);
    expect(lineItem.estimated_total).toBe(100);
  });

  it("uses shortfall_qty directly when min_order_qty is null", () => {
    const shortfalls = [
      makeShortfall({
        shortfall_qty: 25,
        min_order_qty: null,
        unit_price: 3.0,
      }),
    ];

    const result = groupShortfallsBySupplier(shortfalls);
    const lineItem = result[0].line_items[0];

    expect(lineItem.quantity).toBe(25);
    expect(lineItem.estimated_total).toBe(75);
  });

  it("uses 'Unknown Supplier' when supplier name is null", () => {
    const shortfalls = [
      makeShortfall({
        preferred_supplier_id: "sup-099",
        preferred_supplier_name: null,
      }),
    ];

    const result = groupShortfallsBySupplier(shortfalls);
    expect(result[0].supplier_name).toBe("Unknown Supplier");
  });

  it("preserves is_urgent flag on line items", () => {
    const shortfalls = [
      makeShortfall({
        catalog_id: "cat-001",
        is_urgent: true,
      }),
      makeShortfall({
        catalog_id: "cat-002",
        is_urgent: false,
      }),
    ];

    const result = groupShortfallsBySupplier(shortfalls);
    expect(result[0].line_items[0].is_urgent).toBe(true);
    expect(result[0].line_items[1].is_urgent).toBe(false);
  });
});

// =============================================================================
// getCatalogTypeDisplay
// =============================================================================

describe("getCatalogTypeDisplay", () => {
  it("maps 'malt' to 'Malt'", () => {
    expect(getCatalogTypeDisplay("malt")).toBe("Malt");
  });

  it("maps 'hop' to 'Hop'", () => {
    expect(getCatalogTypeDisplay("hop")).toBe("Hop");
  });

  it("maps 'yeast' to 'Yeast'", () => {
    expect(getCatalogTypeDisplay("yeast")).toBe("Yeast");
  });

  it("maps 'adjunct' to 'Adjunct'", () => {
    expect(getCatalogTypeDisplay("adjunct")).toBe("Adjunct");
  });

  it("maps 'sugar' to 'Sugar'", () => {
    expect(getCatalogTypeDisplay("sugar")).toBe("Sugar");
  });

  it("maps 'spice' to 'Spice'", () => {
    expect(getCatalogTypeDisplay("spice")).toBe("Spice");
  });

  it("maps 'fruit' to 'Fruit'", () => {
    expect(getCatalogTypeDisplay("fruit")).toBe("Fruit");
  });

  it("returns the raw type string for unknown types", () => {
    expect(getCatalogTypeDisplay("chemical")).toBe("chemical");
  });

  it("returns the raw type string for empty string", () => {
    expect(getCatalogTypeDisplay("")).toBe("");
  });
});

// =============================================================================
// formatQuantityWithUnit
// =============================================================================

describe("formatQuantityWithUnit", () => {
  it("formats a whole number with unit", () => {
    const result = formatQuantityWithUnit(100, "lbs");
    expect(result).toBe("100 lbs");
  });

  it("formats zero quantity", () => {
    const result = formatQuantityWithUnit(0, "kg");
    expect(result).toBe("0 kg");
  });

  it("formats decimal numbers with up to 2 decimal places", () => {
    const result = formatQuantityWithUnit(12.5, "oz");
    expect(result).toBe("12.5 oz");
  });

  it("truncates beyond 2 decimal places", () => {
    const result = formatQuantityWithUnit(12.999, "oz");
    // toLocaleString with maximumFractionDigits: 2 rounds to 13
    expect(result).toBe("13 oz");
  });

  it("formats large numbers with locale grouping", () => {
    const result = formatQuantityWithUnit(1000, "lbs");
    // Locale-dependent, but should contain 1,000 or 1000
    expect(result).toContain("lbs");
    // The numeric part should represent 1000
    const numericPart = result.replace(" lbs", "").replace(",", "");
    expect(parseFloat(numericPart)).toBe(1000);
  });

  it("formats very small decimal numbers", () => {
    const result = formatQuantityWithUnit(0.25, "oz");
    expect(result).toBe("0.25 oz");
  });
});

// =============================================================================
// formatLandedCost
// =============================================================================

describe("formatLandedCost", () => {
  it("returns 'Not calculated' for null", () => {
    expect(formatLandedCost(null)).toBe("Not calculated");
  });

  it("returns 'Not calculated' for undefined", () => {
    expect(formatLandedCost(undefined)).toBe("Not calculated");
  });

  it("formats zero as $0.0000", () => {
    expect(formatLandedCost(0)).toBe("$0.0000");
  });

  it("formats to 4 decimal places", () => {
    expect(formatLandedCost(1.5)).toBe("$1.5000");
  });

  it("formats a typical landed cost value", () => {
    expect(formatLandedCost(2.3456)).toBe("$2.3456");
  });

  it("appends unit when provided", () => {
    expect(formatLandedCost(1.5, "lbs")).toBe("$1.5000/lbs");
  });

  it("omits unit suffix when unit is not provided", () => {
    expect(formatLandedCost(1.5)).toBe("$1.5000");
  });

  it("returns 'Not calculated' for null even when unit is provided", () => {
    expect(formatLandedCost(null, "lbs")).toBe("Not calculated");
  });

  it("formats a value with many decimals (rounds to 4)", () => {
    expect(formatLandedCost(3.14159265)).toBe("$3.1416");
  });
});

// =============================================================================
// landedCostMarkup
// =============================================================================

describe("landedCostMarkup", () => {
  it("returns null when unitPrice is 0", () => {
    expect(landedCostMarkup(12, 0)).toBeNull();
  });

  it("returns null when unitPrice is falsy (e.g., 0)", () => {
    expect(landedCostMarkup(5, 0)).toBeNull();
  });

  it("calculates correct markup percentage", () => {
    // (12 - 10) / 10 * 100 = 20%
    expect(landedCostMarkup(12, 10)).toBe(20);
  });

  it("returns 0% when landed cost equals unit price", () => {
    expect(landedCostMarkup(10, 10)).toBe(0);
  });

  it("handles negative markup (landed cost less than unit price)", () => {
    // (8 - 10) / 10 * 100 = -20%
    expect(landedCostMarkup(8, 10)).toBe(-20);
  });

  it("handles large markup percentages", () => {
    // (30 - 10) / 10 * 100 = 200%
    expect(landedCostMarkup(30, 10)).toBe(200);
  });

  it("handles fractional unit prices", () => {
    // (1.5 - 1.0) / 1.0 * 100 = 50%
    expect(landedCostMarkup(1.5, 1.0)).toBeCloseTo(50, 10);
  });

  it("handles small differences", () => {
    // (10.01 - 10) / 10 * 100 = 0.1%
    expect(landedCostMarkup(10.01, 10)).toBeCloseTo(0.1, 10);
  });
});
