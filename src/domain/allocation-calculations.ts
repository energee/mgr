/**
 * Allocation Calculation Utilities
 *
 * Pure functions for allocation-based inventory calculations.
 * MGR uses an allocation-based inventory system where quantities are
 * calculated from an allocations table, never stored as mutable balances.
 *
 * These functions are extracted from service and planning modules
 * to enable unit testing without database dependencies.
 */

// =============================================================================
// Types
// =============================================================================

/** A raw allocation record with quantity and optional cost info. */
export type AllocationRecord = {
  id: string;
  quantity: number;
  unit_cost: number | null;
  status: string;
  source_id: string | null;
  source_type: string;
}

/** An inventory lot with received quantity and allocation info. */
export type LotQuantity = {
  lot_id: string;
  received_quantity: number;
  allocated_quantity: number;
}

/** A finished good supply entry with total and allocated quantities. */
export type SupplyEntry = {
  brand_id: string;
  selling_format_id: string;
  total_quantity: number;
  allocated_quantity: number;
}

/** A demand line item for shortage calculation. */
export type DemandItem = {
  brand_id: string | null;
  selling_format_id: string | null;
  quantity: number;
  style_id?: string | null;
  is_tbd?: boolean;
}

/** Result of a shortage calculation for one product. */
export type ShortageResult = {
  key: string;
  total_demand: number;
  available_quantity: number;
  in_production: number;
  shortage: number;
}

// =============================================================================
// Cost Calculations
// =============================================================================

/**
 * Calculate total cost for an allocation.
 * Uses quantity * unit_cost, defaulting unit_cost to 0 if null.
 */
export function calculateAllocationCost(
  quantity: number,
  unitCost: number | null
): number {
  return quantity * (unitCost ?? 0);
}

/**
 * Calculate total cost across multiple allocations.
 * Only includes allocations with active statuses (planned, completed).
 */
export function calculateTotalCost(
  allocations: AllocationRecord[],
  activeStatuses: string[] = ["planned", "completed"]
): number {
  return allocations
    .filter((a) => activeStatuses.includes(a.status))
    .reduce((sum, a) => sum + calculateAllocationCost(a.quantity, a.unit_cost), 0);
}

// =============================================================================
// Availability Calculations
// =============================================================================

/**
 * Calculate remaining quantity for a lot after allocations.
 * remaining = received - allocated (never negative).
 */
export function calculateRemainingQuantity(lot: LotQuantity): number {
  return Math.max(0, lot.received_quantity - lot.allocated_quantity);
}

/**
 * Calculate available quantity for a supply entry.
 * available = total - allocated (never negative).
 */
export function calculateAvailableQuantity(entry: SupplyEntry): number {
  return Math.max(0, entry.total_quantity - entry.allocated_quantity);
}

/**
 * Detect over-allocation: when allocated exceeds total/received.
 * Returns the over-allocation amount, or 0 if not over-allocated.
 */
export function detectOverAllocation(lot: LotQuantity): number {
  return Math.max(0, lot.allocated_quantity - lot.received_quantity);
}

// =============================================================================
// Demand Aggregation
// =============================================================================

/**
 * Generate a grouping key for a demand item.
 * TBD items are keyed by style; regular items by brand.
 */
export function demandGroupKey(item: DemandItem): string {
  if (item.is_tbd) {
    return `tbd:${item.style_id}:${item.selling_format_id}`;
  }
  return `brand:${item.brand_id}:${item.selling_format_id}`;
}

/**
 * Aggregate demand items into grouped totals.
 * Returns a map from group key to total quantity demanded.
 */
export function aggregateDemand(
  items: DemandItem[]
): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    const key = demandGroupKey(item);
    map.set(key, (map.get(key) ?? 0) + item.quantity);
  }
  return map;
}

// =============================================================================
// Shortage Calculation
// =============================================================================

/**
 * Calculate shortage for a single product.
 * shortage = max(0, demand - available - in_production)
 */
export function calculateShortage(
  totalDemand: number,
  availableQuantity: number,
  inProduction: number = 0
): number {
  return Math.max(0, totalDemand - availableQuantity - inProduction);
}

/**
 * Calculate shortages for multiple products given demand and supply maps.
 */
export function calculateShortages(
  demand: Map<string, number>,
  supply: Map<string, number>,
  inProduction: Map<string, number> = new Map()
): ShortageResult[] {
  const results: ShortageResult[] = [];
  for (const [key, totalDemand] of demand) {
    const available = supply.get(key) ?? 0;
    const producing = inProduction.get(key) ?? 0;
    results.push({
      key,
      total_demand: totalDemand,
      available_quantity: available,
      in_production: producing,
      shortage: calculateShortage(totalDemand, available, producing),
    });
  }
  return results;
}

// =============================================================================
// Lot Quantity Aggregation
// =============================================================================

/** A lot with remaining quantity for aggregation. */
export type LotWithRemaining = {
  inventory_item_id: string | null;
  remaining_quantity: number;
  expiration_date: string | null;
}

/**
 * Aggregate lot quantities by inventory item.
 * Returns total remaining quantity per item.
 */
export function aggregateLotQuantities(
  lots: LotWithRemaining[]
): Map<string, number> {
  const map = new Map<string, number>();
  for (const lot of lots) {
    if (!lot.inventory_item_id) continue;
    map.set(
      lot.inventory_item_id,
      (map.get(lot.inventory_item_id) ?? 0) + lot.remaining_quantity
    );
  }
  return map;
}

/**
 * Find the earliest expiration date across lots for an item.
 * Returns null if no lots have expiration dates.
 */
export function earliestExpiration(
  lots: LotWithRemaining[],
  itemId: string
): string | null {
  let earliest: string | null = null;
  for (const l of lots) {
    if (l.inventory_item_id === itemId && l.expiration_date !== null) {
      if (earliest === null || l.expiration_date < earliest) {
        earliest = l.expiration_date;
      }
    }
  }
  return earliest;
}

// =============================================================================
// Days Until Expiry
// =============================================================================

/**
 * Calculate days until expiration from a given reference date.
 * Returns negative values for already-expired lots.
 */
export function daysUntilExpiry(
  expirationDate: string,
  referenceDate: Date = new Date()
): number {
  const expDate = new Date(expirationDate);
  const diffTime = expDate.getTime() - referenceDate.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

// =============================================================================
// Low Stock Detection
// =============================================================================

/**
 * Check if an inventory item is below its reorder point.
 */
export function isBelowReorderPoint(
  currentQuantity: number,
  reorderPoint: number | null
): boolean {
  if (reorderPoint === null || reorderPoint <= 0) return false;
  return currentQuantity < reorderPoint;
}
