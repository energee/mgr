/**
 * Ingredient Demand Calculator
 *
 * TypeScript utilities for calculating ingredient demand from planned/fermenting
 * batches and identifying shortfalls requiring purchase orders.
 */

import { createClient } from "@/lib/supabase/client";

// =============================================================================
// Types
// =============================================================================

export interface IngredientDemand {
  catalog_type: string;
  catalog_id: string;
  catalog_name: string;
  total_required: number;
  unit: string;
  earliest_required_by: string;
  batch_count: number;
}

export interface IngredientShortfall {
  catalog_type: string;
  catalog_id: string;
  catalog_name: string;
  total_required: number;
  available_qty: number;
  shortfall_qty: number;
  unit: string;
  required_by_date: string;
  order_by_date: string;
  lead_time_days: number;
  preferred_supplier_id: string | null;
  preferred_supplier_name: string | null;
  min_order_qty: number | null;
  unit_price: number | null;
  is_urgent: boolean;
  batch_count: number;
}

export interface DemandSummary {
  totalDemand: number;
  coveredByInventory: number;
  shortfallCount: number;
  urgentCount: number;
  totalIngredients: number;
}

// =============================================================================
// Functions
// =============================================================================

/**
 * Calculate total ingredient demand from planned and fermenting batches
 */
export async function calculateIngredientDemand(
  horizonWeeks = 8,
  includePlanned = true,
  includeFermenting = true
): Promise<IngredientDemand[]> {
  const supabase = createClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("calculate_ingredient_demand", {
    p_horizon_weeks: horizonWeeks,
    p_include_planned: includePlanned,
    p_include_fermenting: includeFermenting,
  });

  if (error) {
    console.error("Error calculating ingredient demand:", error);
    throw error;
  }

  return (data || []) as IngredientDemand[];
}

/**
 * Calculate ingredient shortfalls (demand - available inventory)
 */
export async function calculateIngredientShortfalls(
  horizonWeeks = 8
): Promise<IngredientShortfall[]> {
  const supabase = createClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("calculate_ingredient_shortfalls", {
    p_horizon_weeks: horizonWeeks,
  });

  if (error) {
    console.error("Error calculating ingredient shortfalls:", error);
    throw error;
  }

  return (data || []) as IngredientShortfall[];
}

/**
 * Get demand summary statistics
 */
export async function getDemandSummary(horizonWeeks = 8): Promise<DemandSummary> {
  const shortfalls = await calculateIngredientShortfalls(horizonWeeks);
  const demand = await calculateIngredientDemand(horizonWeeks);

  const totalDemand = demand.reduce((sum, d) => sum + d.total_required, 0);
  const shortfallTotal = shortfalls.reduce((sum, s) => sum + s.shortfall_qty, 0);
  const coveredByInventory = totalDemand - shortfallTotal;

  return {
    totalDemand,
    coveredByInventory,
    shortfallCount: shortfalls.length,
    urgentCount: shortfalls.filter((s) => s.is_urgent).length,
    totalIngredients: demand.length,
  };
}

/**
 * Get catalog type display name
 */
export function getCatalogTypeDisplay(catalogType: string): string {
  const displays: Record<string, string> = {
    malt: "Malt",
    hop: "Hop",
    yeast: "Yeast",
    adjunct: "Adjunct",
    sugar: "Sugar",
    spice: "Spice",
    fruit: "Fruit",
  };
  return displays[catalogType] || catalogType;
}

/**
 * Format quantity with unit
 */
export function formatQuantityWithUnit(quantity: number, unit: string): string {
  const formatted = quantity.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${formatted} ${unit}`;
}
