/**
 * Landed Cost Calculation
 *
 * Utilities for calculating and displaying per-unit landed costs on inventory lots.
 * Landed cost includes the item unit price plus an allocated share of PO shipping costs.
 */

import { log } from "@/lib/client-logger";

/** Lazy-import supabase client to avoid env validation at module load time. */
async function getSupabase() {
  const { createClient } = await import("@/lib/supabase/client");
  return createClient();
}

// =============================================================================
// Types
// =============================================================================

export type LandedCostBreakdown = {
  lot_id: string | null;
  line_item_id: string | null;
  catalog_type: string;
  quantity: number;
  unit_price: number | null;
  allocated_shipping: number;
  landed_cost_per_unit: number;
}

export type LandedCostSummary = {
  po_id: string;
  shipping_cost: number;
  line_items: LandedCostBreakdown[];
  total_item_cost: number;
  total_landed_cost: number;
}

// =============================================================================
// Functions
// =============================================================================

/**
 * Calculate landed cost for all lots on a purchase order.
 * Calls the database function which allocates shipping cost proportionally
 * by line item value and updates the landed_cost on each inventory_lot.
 */
export async function calculateLandedCost(
  poId: string
): Promise<LandedCostBreakdown[]> {
  const supabase = await getSupabase();

  const { data, error } = await supabase.rpc("calculate_landed_cost", {
    p_po_id: poId,
  });

  if (error) {
    log.error("Error calculating landed cost:", error);
    throw error;
  }

  return (data || []) as LandedCostBreakdown[];
}

/**
 * Get a full landed cost summary for a PO including totals.
 */
export async function getLandedCostSummary(
  poId: string
): Promise<LandedCostSummary> {
  const supabase = await getSupabase();

  // Get the PO shipping cost
  const { data: po, error: poError } = await supabase
    .from("purchase_orders")
    .select("shipping_cost")
    .eq("id", poId)
    .single();

  if (poError) {
    log.error("Error fetching PO:", poError);
    throw poError;
  }

  // Calculate landed costs (this also updates the lots)
  const lineItems = await calculateLandedCost(poId);

  const totalItemCost = lineItems.reduce(
    (sum, item) => sum + (item.unit_price || 0) * item.quantity,
    0
  );

  const totalLandedCost = lineItems.reduce(
    (sum, item) => sum + item.landed_cost_per_unit * item.quantity,
    0
  );

  return {
    po_id: poId,
    shipping_cost: po.shipping_cost || 0,
    line_items: lineItems,
    total_item_cost: totalItemCost,
    total_landed_cost: totalLandedCost,
  };
}

/**
 * Format a landed cost value for display.
 */
export function formatLandedCost(
  value: number | null | undefined,
  unit?: string
): string {
  if (value == null) return "Not calculated";
  const formatted = `$${value.toFixed(4)}`;
  return unit ? `${formatted}/${unit}` : formatted;
}

/**
 * Calculate the landed cost markup percentage over base unit price.
 */
export function landedCostMarkup(
  landedCost: number,
  unitPrice: number
): number | null {
  if (!unitPrice) return null;
  return ((landedCost - unitPrice) / unitPrice) * 100;
}
