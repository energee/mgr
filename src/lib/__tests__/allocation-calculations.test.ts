/**
 * Allocation Calculation Tests
 *
 * Tests for pure allocation-based inventory calculation functions.
 * MGR uses allocation-based inventory: quantities are always derived
 * from the allocations table, never stored as mutable balances.
 *
 * Covers: cost calculations, availability, over-allocation detection,
 * demand aggregation, shortage calculation, lot aggregation,
 * expiration tracking, and low stock detection.
 */

import { describe, it, expect } from "vitest";
import {
  calculateAllocationCost,
  calculateTotalCost,
  calculateRemainingQuantity,
  calculateAvailableQuantity,
  detectOverAllocation,
  demandGroupKey,
  aggregateDemand,
  calculateShortage,
  calculateShortages,
  aggregateLotQuantities,
  earliestExpiration,
  daysUntilExpiry,
  isBelowReorderPoint,
  type AllocationRecord,
  type LotQuantity,
  type SupplyEntry,
  type DemandItem,
  type LotWithRemaining,
} from "\@/domain/allocation-calculations";

// =============================================================================
// Cost Calculations
// =============================================================================

describe("calculateAllocationCost", () => {
  it("multiplies quantity by unit cost", () => {
    expect(calculateAllocationCost(10, 5.5)).toBe(55);
  });

  it("returns 0 when unit cost is null", () => {
    expect(calculateAllocationCost(10, null)).toBe(0);
  });

  it("returns 0 for zero quantity", () => {
    expect(calculateAllocationCost(0, 10)).toBe(0);
  });

  it("handles fractional quantities", () => {
    expect(calculateAllocationCost(2.5, 4)).toBe(10);
  });

  it("handles fractional unit costs", () => {
    expect(calculateAllocationCost(3, 1.99)).toBeCloseTo(5.97, 10);
  });
});

describe("calculateTotalCost", () => {
  const allocations: AllocationRecord[] = [
    { id: "a1", quantity: 10, unit_cost: 5, status: "completed", source_id: "s1", source_type: "inventory_lot" },
    { id: "a2", quantity: 5, unit_cost: 3, status: "planned", source_id: "s2", source_type: "inventory_lot" },
    { id: "a3", quantity: 8, unit_cost: 2, status: "cancelled", source_id: "s3", source_type: "inventory_lot" },
    { id: "a4", quantity: 4, unit_cost: null, status: "completed", source_id: "s4", source_type: "external" },
  ];

  it("sums costs for planned and completed allocations only", () => {
    // a1: 10*5=50, a2: 5*3=15, a4: 4*0=0 => 65
    expect(calculateTotalCost(allocations)).toBe(65);
  });

  it("excludes cancelled allocations", () => {
    // a3 has status "cancelled" and should be excluded
    const allCost = allocations.reduce(
      (sum, a) => sum + a.quantity * (a.unit_cost ?? 0),
      0
    );
    expect(calculateTotalCost(allocations)).toBeLessThan(allCost);
  });

  it("allows custom active statuses", () => {
    // Only count "completed"
    expect(calculateTotalCost(allocations, ["completed"])).toBe(50); // a1: 50, a4: 0
  });

  it("returns 0 for empty allocations", () => {
    expect(calculateTotalCost([])).toBe(0);
  });

  it("returns 0 when no allocations match active statuses", () => {
    expect(calculateTotalCost(allocations, ["shipped"])).toBe(0);
  });
});

// =============================================================================
// Availability Calculations
// =============================================================================

describe("calculateRemainingQuantity", () => {
  it("calculates remaining as received minus allocated", () => {
    const lot: LotQuantity = { lot_id: "l1", received_quantity: 100, allocated_quantity: 30 };
    expect(calculateRemainingQuantity(lot)).toBe(70);
  });

  it("returns 0 when fully allocated", () => {
    const lot: LotQuantity = { lot_id: "l1", received_quantity: 100, allocated_quantity: 100 };
    expect(calculateRemainingQuantity(lot)).toBe(0);
  });

  it("returns 0 when over-allocated (never negative)", () => {
    const lot: LotQuantity = { lot_id: "l1", received_quantity: 50, allocated_quantity: 75 };
    expect(calculateRemainingQuantity(lot)).toBe(0);
  });

  it("returns full quantity when nothing allocated", () => {
    const lot: LotQuantity = { lot_id: "l1", received_quantity: 200, allocated_quantity: 0 };
    expect(calculateRemainingQuantity(lot)).toBe(200);
  });

  it("handles zero received quantity", () => {
    const lot: LotQuantity = { lot_id: "l1", received_quantity: 0, allocated_quantity: 0 };
    expect(calculateRemainingQuantity(lot)).toBe(0);
  });
});

describe("calculateAvailableQuantity", () => {
  it("calculates available as total minus allocated", () => {
    const entry: SupplyEntry = {
      brand_id: "b1", selling_format_id: "sf1",
      total_quantity: 200, allocated_quantity: 50,
    };
    expect(calculateAvailableQuantity(entry)).toBe(150);
  });

  it("never returns negative", () => {
    const entry: SupplyEntry = {
      brand_id: "b1", selling_format_id: "sf1",
      total_quantity: 10, allocated_quantity: 20,
    };
    expect(calculateAvailableQuantity(entry)).toBe(0);
  });
});

describe("detectOverAllocation", () => {
  it("returns 0 when not over-allocated", () => {
    const lot: LotQuantity = { lot_id: "l1", received_quantity: 100, allocated_quantity: 50 };
    expect(detectOverAllocation(lot)).toBe(0);
  });

  it("returns 0 when exactly allocated", () => {
    const lot: LotQuantity = { lot_id: "l1", received_quantity: 100, allocated_quantity: 100 };
    expect(detectOverAllocation(lot)).toBe(0);
  });

  it("returns the over-allocation amount", () => {
    const lot: LotQuantity = { lot_id: "l1", received_quantity: 50, allocated_quantity: 75 };
    expect(detectOverAllocation(lot)).toBe(25);
  });

  it("handles zero received with allocations (full over-allocation)", () => {
    const lot: LotQuantity = { lot_id: "l1", received_quantity: 0, allocated_quantity: 10 };
    expect(detectOverAllocation(lot)).toBe(10);
  });
});

// =============================================================================
// Demand Aggregation
// =============================================================================

describe("demandGroupKey", () => {
  it("generates brand key for regular items", () => {
    const item: DemandItem = {
      brand_id: "brand-1", selling_format_id: "sf-1", quantity: 10,
    };
    expect(demandGroupKey(item)).toBe("brand:brand-1:sf-1");
  });

  it("generates tbd key for TBD items", () => {
    const item: DemandItem = {
      brand_id: null, selling_format_id: "sf-2", quantity: 5,
      is_tbd: true, style_id: "style-1",
    };
    expect(demandGroupKey(item)).toBe("tbd:style-1:sf-2");
  });

  it("uses brand key when is_tbd is false even with style_id", () => {
    const item: DemandItem = {
      brand_id: "brand-2", selling_format_id: "sf-3", quantity: 3,
      is_tbd: false, style_id: "style-1",
    };
    expect(demandGroupKey(item)).toBe("brand:brand-2:sf-3");
  });

  it("handles null brand_id for non-TBD items", () => {
    const item: DemandItem = {
      brand_id: null, selling_format_id: "sf-1", quantity: 1,
    };
    expect(demandGroupKey(item)).toBe("brand:null:sf-1");
  });
});

describe("aggregateDemand", () => {
  it("sums quantities for the same key", () => {
    const items: DemandItem[] = [
      { brand_id: "b1", selling_format_id: "sf1", quantity: 10 },
      { brand_id: "b1", selling_format_id: "sf1", quantity: 5 },
      { brand_id: "b1", selling_format_id: "sf1", quantity: 3 },
    ];
    const result = aggregateDemand(items);
    expect(result.get("brand:b1:sf1")).toBe(18);
  });

  it("separates different brands", () => {
    const items: DemandItem[] = [
      { brand_id: "b1", selling_format_id: "sf1", quantity: 10 },
      { brand_id: "b2", selling_format_id: "sf1", quantity: 7 },
    ];
    const result = aggregateDemand(items);
    expect(result.get("brand:b1:sf1")).toBe(10);
    expect(result.get("brand:b2:sf1")).toBe(7);
  });

  it("separates different selling formats for the same brand", () => {
    const items: DemandItem[] = [
      { brand_id: "b1", selling_format_id: "sf1", quantity: 10 },
      { brand_id: "b1", selling_format_id: "sf2", quantity: 20 },
    ];
    const result = aggregateDemand(items);
    expect(result.get("brand:b1:sf1")).toBe(10);
    expect(result.get("brand:b1:sf2")).toBe(20);
  });

  it("separates TBD items from brand items", () => {
    const items: DemandItem[] = [
      { brand_id: "b1", selling_format_id: "sf1", quantity: 10 },
      { brand_id: null, selling_format_id: "sf1", quantity: 5, is_tbd: true, style_id: "s1" },
    ];
    const result = aggregateDemand(items);
    expect(result.size).toBe(2);
    expect(result.get("brand:b1:sf1")).toBe(10);
    expect(result.get("tbd:s1:sf1")).toBe(5);
  });

  it("returns empty map for empty input", () => {
    expect(aggregateDemand([]).size).toBe(0);
  });
});

// =============================================================================
// Shortage Calculation
// =============================================================================

describe("calculateShortage", () => {
  it("returns 0 when supply meets demand", () => {
    expect(calculateShortage(100, 100)).toBe(0);
  });

  it("returns 0 when supply exceeds demand", () => {
    expect(calculateShortage(50, 100)).toBe(0);
  });

  it("returns shortage when demand exceeds available", () => {
    expect(calculateShortage(100, 30)).toBe(70);
  });

  it("accounts for in-production quantity", () => {
    // demand=100, available=30, in_production=50 => shortage=20
    expect(calculateShortage(100, 30, 50)).toBe(20);
  });

  it("returns 0 when in-production covers the gap", () => {
    expect(calculateShortage(100, 30, 80)).toBe(0);
  });

  it("handles zero demand", () => {
    expect(calculateShortage(0, 50, 10)).toBe(0);
  });

  it("handles all-zero inputs", () => {
    expect(calculateShortage(0, 0, 0)).toBe(0);
  });
});

describe("calculateShortages", () => {
  it("calculates shortages for multiple products", () => {
    const demand = new Map([
      ["brand:b1:sf1", 100],
      ["brand:b2:sf1", 50],
    ]);
    const supply = new Map([
      ["brand:b1:sf1", 80],
      ["brand:b2:sf1", 60],
    ]);

    const results = calculateShortages(demand, supply);
    expect(results).toHaveLength(2);

    const b1 = results.find((r) => r.key === "brand:b1:sf1");
    expect(b1?.shortage).toBe(20);
    expect(b1?.total_demand).toBe(100);
    expect(b1?.available_quantity).toBe(80);

    const b2 = results.find((r) => r.key === "brand:b2:sf1");
    expect(b2?.shortage).toBe(0);
  });

  it("treats missing supply as zero", () => {
    const demand = new Map([["brand:b1:sf1", 50]]);
    const supply = new Map<string, number>();

    const results = calculateShortages(demand, supply);
    expect(results[0].shortage).toBe(50);
    expect(results[0].available_quantity).toBe(0);
  });

  it("includes in-production quantities", () => {
    const demand = new Map([["brand:b1:sf1", 100]]);
    const supply = new Map([["brand:b1:sf1", 30]]);
    const inProduction = new Map([["brand:b1:sf1", 50]]);

    const results = calculateShortages(demand, supply, inProduction);
    expect(results[0].shortage).toBe(20);
    expect(results[0].in_production).toBe(50);
  });

  it("returns empty array for empty demand", () => {
    expect(calculateShortages(new Map(), new Map())).toEqual([]);
  });
});

// =============================================================================
// Lot Quantity Aggregation
// =============================================================================

describe("aggregateLotQuantities", () => {
  it("sums remaining quantities per item", () => {
    const lots: LotWithRemaining[] = [
      { inventory_item_id: "item-1", remaining_quantity: 50, expiration_date: null },
      { inventory_item_id: "item-1", remaining_quantity: 30, expiration_date: null },
      { inventory_item_id: "item-2", remaining_quantity: 100, expiration_date: null },
    ];
    const result = aggregateLotQuantities(lots);
    expect(result.get("item-1")).toBe(80);
    expect(result.get("item-2")).toBe(100);
  });

  it("skips lots with null inventory_item_id", () => {
    const lots: LotWithRemaining[] = [
      { inventory_item_id: null, remaining_quantity: 50, expiration_date: null },
      { inventory_item_id: "item-1", remaining_quantity: 30, expiration_date: null },
    ];
    const result = aggregateLotQuantities(lots);
    expect(result.size).toBe(1);
    expect(result.get("item-1")).toBe(30);
  });

  it("handles zero remaining quantities", () => {
    const lots: LotWithRemaining[] = [
      { inventory_item_id: "item-1", remaining_quantity: 0, expiration_date: null },
      { inventory_item_id: "item-1", remaining_quantity: 0, expiration_date: null },
    ];
    const result = aggregateLotQuantities(lots);
    expect(result.get("item-1")).toBe(0);
  });

  it("returns empty map for empty input", () => {
    expect(aggregateLotQuantities([]).size).toBe(0);
  });
});

describe("earliestExpiration", () => {
  it("returns the earliest expiration date for an item", () => {
    const lots: LotWithRemaining[] = [
      { inventory_item_id: "item-1", remaining_quantity: 10, expiration_date: "2026-06-15" },
      { inventory_item_id: "item-1", remaining_quantity: 20, expiration_date: "2026-03-01" },
      { inventory_item_id: "item-1", remaining_quantity: 5, expiration_date: "2026-09-20" },
    ];
    expect(earliestExpiration(lots, "item-1")).toBe("2026-03-01");
  });

  it("returns null when no lots have expiration dates", () => {
    const lots: LotWithRemaining[] = [
      { inventory_item_id: "item-1", remaining_quantity: 10, expiration_date: null },
    ];
    expect(earliestExpiration(lots, "item-1")).toBeNull();
  });

  it("filters by item ID", () => {
    const lots: LotWithRemaining[] = [
      { inventory_item_id: "item-1", remaining_quantity: 10, expiration_date: "2026-01-01" },
      { inventory_item_id: "item-2", remaining_quantity: 20, expiration_date: "2025-12-01" },
    ];
    expect(earliestExpiration(lots, "item-1")).toBe("2026-01-01");
  });

  it("returns null for non-existent item", () => {
    const lots: LotWithRemaining[] = [
      { inventory_item_id: "item-1", remaining_quantity: 10, expiration_date: "2026-01-01" },
    ];
    expect(earliestExpiration(lots, "item-99")).toBeNull();
  });

  it("ignores lots with null expiration among mixed lots", () => {
    const lots: LotWithRemaining[] = [
      { inventory_item_id: "item-1", remaining_quantity: 10, expiration_date: null },
      { inventory_item_id: "item-1", remaining_quantity: 20, expiration_date: "2026-04-15" },
    ];
    expect(earliestExpiration(lots, "item-1")).toBe("2026-04-15");
  });
});

// =============================================================================
// Days Until Expiry
// =============================================================================

describe("daysUntilExpiry", () => {
  it("returns positive days for future expiration", () => {
    const ref = new Date("2026-03-01T00:00:00Z");
    expect(daysUntilExpiry("2026-03-11", ref)).toBe(10);
  });

  it("returns 0 for same-day expiration", () => {
    const ref = new Date("2026-03-01T00:00:00Z");
    expect(daysUntilExpiry("2026-03-01", ref)).toBe(0);
  });

  it("returns negative days for past expiration", () => {
    const ref = new Date("2026-03-10T00:00:00Z");
    expect(daysUntilExpiry("2026-03-05", ref)).toBe(-5);
  });

  it("rounds up partial days (ceil)", () => {
    // Reference is noon on March 1, expiration is March 2 (midnight)
    const ref = new Date("2026-03-01T12:00:00Z");
    // Diff is 0.5 days, ceil => 1
    expect(daysUntilExpiry("2026-03-02", ref)).toBe(1);
  });
});

// =============================================================================
// Low Stock Detection
// =============================================================================

describe("isBelowReorderPoint", () => {
  it("returns true when quantity is below reorder point", () => {
    expect(isBelowReorderPoint(5, 10)).toBe(true);
  });

  it("returns false when quantity meets reorder point", () => {
    expect(isBelowReorderPoint(10, 10)).toBe(false);
  });

  it("returns false when quantity exceeds reorder point", () => {
    expect(isBelowReorderPoint(15, 10)).toBe(false);
  });

  it("returns false when reorder point is null", () => {
    expect(isBelowReorderPoint(5, null)).toBe(false);
  });

  it("returns false when reorder point is 0", () => {
    expect(isBelowReorderPoint(0, 0)).toBe(false);
  });

  it("returns false when reorder point is negative", () => {
    expect(isBelowReorderPoint(0, -5)).toBe(false);
  });

  it("returns true for zero quantity with positive reorder point", () => {
    expect(isBelowReorderPoint(0, 10)).toBe(true);
  });
});

// =============================================================================
// Integration: Multi-allocation against same source
// =============================================================================

describe("multiple allocations against same source", () => {
  it("correctly calculates remaining after multiple partial allocations", () => {
    const lot: LotQuantity = {
      lot_id: "lot-1",
      received_quantity: 100,
      allocated_quantity: 0,
    };

    // Simulate three allocations: 20, 30, 15
    const allocationQuantities = [20, 30, 15];
    const totalAllocated = allocationQuantities.reduce((s, q) => s + q, 0);
    lot.allocated_quantity = totalAllocated;

    expect(calculateRemainingQuantity(lot)).toBe(35); // 100 - 65
    expect(detectOverAllocation(lot)).toBe(0);
  });

  it("detects over-allocation when cumulative exceeds received", () => {
    const lot: LotQuantity = {
      lot_id: "lot-1",
      received_quantity: 50,
      allocated_quantity: 0,
    };

    // Simulate allocations that exceed received: 20, 20, 15
    const totalAllocated = 20 + 20 + 15; // 55
    lot.allocated_quantity = totalAllocated;

    expect(calculateRemainingQuantity(lot)).toBe(0);
    expect(detectOverAllocation(lot)).toBe(5); // 55 - 50
  });
});

// =============================================================================
// Integration: End-to-end shortage with demand and supply
// =============================================================================

describe("end-to-end shortage workflow", () => {
  it("calculates correct shortages from demand items and supply entries", () => {
    // Demand: 3 orders for brand-1/sixpack, 1 order for brand-2/case
    const demandItems: DemandItem[] = [
      { brand_id: "b1", selling_format_id: "sixpack", quantity: 24 },
      { brand_id: "b1", selling_format_id: "sixpack", quantity: 12 },
      { brand_id: "b1", selling_format_id: "sixpack", quantity: 6 },
      { brand_id: "b2", selling_format_id: "case", quantity: 10 },
    ];

    // Aggregate demand
    const demand = aggregateDemand(demandItems);
    expect(demand.get("brand:b1:sixpack")).toBe(42);
    expect(demand.get("brand:b2:case")).toBe(10);

    // Supply
    const supply = new Map([
      ["brand:b1:sixpack", 30],
      ["brand:b2:case", 15],
    ]);

    // Calculate shortages
    const shortages = calculateShortages(demand, supply);

    const b1 = shortages.find((s) => s.key === "brand:b1:sixpack");
    expect(b1?.shortage).toBe(12); // 42 - 30 = 12

    const b2 = shortages.find((s) => s.key === "brand:b2:case");
    expect(b2?.shortage).toBe(0); // 10 - 15 = 0 (clamped)
  });
});
