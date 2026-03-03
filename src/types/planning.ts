/**
 * Production Planning Types
 *
 * Types for backward production planning from orders.
 * Supports demand aggregation, supply tracking, and shortfall calculation.
 */

// =============================================================================
// Shortfall Calculation Result
// =============================================================================

export interface ProductionShortfall {
  brand_id: string;
  brand_name: string;
  selling_format_id: string;
  selling_format_name: string;
  demand_week: string;
  demand_quantity: number;
  available_quantity: number;
  in_production_bbl: number;
  in_production_units: number;
  shortfall_quantity: number;
  recommended_brew_start: string;
  lead_time_days: number;
  recipe_id: string | null;
  recipe_name: string | null;
  is_urgent: boolean;
}

// =============================================================================
// Demand Aggregation
// =============================================================================

export interface DemandByProduct {
  brand_id: string;
  selling_format_id: string;
  demand_week: string;
  total_quantity: number;
  order_count: number;
  earliest_due_date: string;
  latest_due_date: string;
  order_ids: string[];
  order_statuses: string[];
}

// =============================================================================
// Supply Aggregation
// =============================================================================

export interface SupplyByProduct {
  brand_id: string;
  selling_format_id: string;
  total_quantity: number;
  available_quantity: number;
  allocated_quantity: number;
  reserved_quantity: number;
}

// =============================================================================
// In-Production Batches
// =============================================================================

export interface BatchInProduction {
  brand_id: string;
  batch_id: string;
  batch_number: string;
  batch_name: string;
  status: string;
  planned_start_date: string | null;
  volume_bbl: number;
  recipe_id: string;
  recipe_name: string;
  fermentation_days: number | null;
  conditioning_days: number | null;
  estimated_ready_date: string | null;
}

// =============================================================================
// Planning Filters & Options
// =============================================================================

export interface PlanningFilters {
  includeDrafts: boolean;
  horizonWeeks: number;
  brandId?: string;
  recipeId?: string;
}

export const DEFAULT_PLANNING_FILTERS: PlanningFilters = {
  includeDrafts: true,
  horizonWeeks: 8,
};

// =============================================================================
// Planning Summary (for dashboard card)
// =============================================================================

export interface PlanningSummary {
  totalDemand: number;
  availableSupply: number;
  inProduction: number;
  shortfallCount: number;
  urgentCount: number;
}
