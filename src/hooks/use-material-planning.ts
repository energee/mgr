/**
 * Material planning hooks — data fetching for BOM, shortfalls, order materials,
 * and session material previews used by the packaging material planning UI.
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { dynamicFrom, dynamicRpc } from "@/services/types";
import { materialPlanningKeys } from "@/lib/query-keys";

// =============================================================================
// Types
// =============================================================================

/** A single line item in a selling format's bill of materials. */
export type SellingFormatMaterial = {
  id: string;
  selling_format_id: string;
  inventory_item_id: string;
  quantity_per_unit: number;
  unit_of_measure: string | null;
  notes: string | null;
  inventory_item: {
    id: string;
    name: string;
    sku: string | null;
    category: string | null;
    unit_of_measure: string | null;
  } | null;
};

/** A material shortfall — demand exceeds on-hand inventory. */
export type MaterialShortfall = {
  inventory_item_id: string;
  inventory_item_name: string;
  demand_quantity: number;
  on_hand_quantity: number;
  shortfall_quantity: number;
  unit_of_measure: string | null;
  demand_source: string | null;
};

/** Material requirement for a specific order. */
export type OrderMaterial = {
  id: string;
  order_id: string;
  inventory_item_id: string;
  /** Auto-calculated estimated quantity based on BOM x order items. */
  estimated_qty: number;
  /** User-overridable actual quantity; null means "use estimated_qty". */
  actual_qty: number | null;
  inventory_item: {
    id: string;
    name: string;
    sku: string | null;
    category: string | null;
    unit_of_measure: string | null;
  } | null;
};

/**
 * Aggregated material preview for a packaging session.
 * Shows total material need vs on-hand, sorted by shortfall descending.
 */
export type SessionMaterialPreview = {
  inventory_item_id: string;
  inventory_item_name: string;
  sku: string | null;
  category: string | null;
  unit_of_measure: string | null;
  total_required: number;
  on_hand_quantity: number;
  shortfall: number;
};

// =============================================================================
// Hooks
// =============================================================================

/**
 * Fetch the bill of materials for a selling format.
 * Joins selling_format_materials with inventory_item for display fields.
 */
export function useSellingFormatBOM(sellingFormatId: string | null) {
  const supabase = createClient();
  return useQuery({
    queryKey: materialPlanningKeys.bom(sellingFormatId ?? ""),
    queryFn: async (): Promise<SellingFormatMaterial[]> => {
      const { data, error } = await dynamicFrom(supabase, "selling_format_materials")
        .select(
          `id, selling_format_id, inventory_item_id, quantity_per_unit, unit_of_measure, notes,
           inventory_item:inventory_items(id, name, sku, category, unit_of_measure)`
        )
        .eq("selling_format_id", sellingFormatId!);
      if (error) throw error;
      return (data ?? []) as unknown as SellingFormatMaterial[];
    },
    enabled: !!sellingFormatId,
  });
}

/**
 * Calculate material shortfalls across all pending demand.
 * Calls the `calculate_material_shortfalls` database RPC which aggregates
 * BOM demand vs on-hand inventory quantities.
 *
 * @param options.horizonWeeks - Number of weeks to look ahead for demand (default: 4)
 * @param options.demandSource - Filter to a specific demand source client-side (e.g. "order")
 */
export function useMaterialShortfalls(options?: {
  horizonWeeks?: number;
  demandSource?: string;
}) {
  const supabase = createClient();
  const { horizonWeeks, demandSource } = options ?? {};
  return useQuery({
    queryKey: materialPlanningKeys.shortfalls(options),
    queryFn: async (): Promise<MaterialShortfall[]> => {
      const { data, error } = await dynamicRpc(
        supabase,
        "calculate_material_shortfalls",
        { horizon_weeks: horizonWeeks ?? 4 }
      );
      if (error) throw error;
      const rows = (data ?? []) as MaterialShortfall[];
      if (demandSource) {
        return rows.filter((r) => r.demand_source === demandSource);
      }
      return rows;
    },
  });
}

/**
 * Fetch material requirements for a specific order.
 * Joins order_materials with inventory_item for display fields.
 */
export function useOrderMaterials(orderId: string | null) {
  const supabase = createClient();
  return useQuery({
    queryKey: materialPlanningKeys.orderMaterials(orderId ?? ""),
    queryFn: async (): Promise<OrderMaterial[]> => {
      const { data, error } = await dynamicFrom(supabase, "order_materials")
        .select(
          `id, order_id, inventory_item_id, estimated_qty, actual_qty,
           inventory_item:inventory_items(id, name, sku, category, unit_of_measure)`
        )
        .eq("order_id", orderId!);
      if (error) throw error;
      return (data ?? []) as unknown as OrderMaterial[];
    },
    enabled: !!orderId,
  });
}

/**
 * Compute a material preview for a packaging session.
 *
 * Steps:
 * 1. Fetch all session_line_items for the session with their planned_quantity and selling_format_id.
 * 2. Fetch selling_format_materials for those format IDs to get per-unit BOM.
 * 3. Aggregate total required quantity per inventory_item across all line items.
 * 4. Fetch on-hand quantities from inventory_lots_with_quantities.
 * 5. Return items sorted by shortfall descending (most urgent first).
 */
export function useSessionMaterialPreview(sessionId: string | null) {
  const supabase = createClient();
  return useQuery({
    queryKey: materialPlanningKeys.sessionMaterials(sessionId ?? ""),
    queryFn: async (): Promise<SessionMaterialPreview[]> => {
      // Step 1: Get line items for session
      const { data: lineItems, error: lineErr } = await dynamicFrom(supabase, "packaging_session_line_items")
        .select("selling_format_id, planned_quantity")
        .eq("session_id", sessionId!);
      if (lineErr) throw lineErr;
      if (!lineItems || lineItems.length === 0) return [];

      const typedLineItems = lineItems as unknown as Array<{
        selling_format_id: string | null;
        planned_quantity: number | null;
      }>;

      // Collect unique selling format IDs that have a BOM
      const formatIds = [
        ...new Set(
          typedLineItems
            .map((li) => li.selling_format_id)
            .filter((id): id is string => !!id)
        ),
      ];

      if (formatIds.length === 0) return [];

      // Step 2: Fetch BOM for all relevant formats
      const { data: bomRows, error: bomErr } = await dynamicFrom(supabase, "selling_format_materials")
        .select(
          `selling_format_id, inventory_item_id, quantity_per_unit, unit_of_measure,
           inventory_item:inventory_items(id, name, sku, category, unit_of_measure)`
        )
        .in("selling_format_id", formatIds);
      if (bomErr) throw bomErr;

      const typedBOM = (bomRows ?? []) as unknown as Array<{
        selling_format_id: string;
        inventory_item_id: string;
        quantity_per_unit: number;
        unit_of_measure: string | null;
        inventory_item: {
          id: string;
          name: string;
          sku: string | null;
          category: string | null;
          unit_of_measure: string | null;
        } | null;
      }>;

      // Step 3: Aggregate required quantities per inventory_item
      type AggEntry = {
        inventory_item_id: string;
        inventory_item_name: string;
        sku: string | null;
        category: string | null;
        unit_of_measure: string | null;
        total_required: number;
      };
      const aggregated = new Map<string, AggEntry>();

      for (const li of typedLineItems) {
        if (!li.selling_format_id || !li.planned_quantity) continue;
        const bomForFormat = typedBOM.filter(
          (b) => b.selling_format_id === li.selling_format_id
        );
        for (const bom of bomForFormat) {
          const required = bom.quantity_per_unit * li.planned_quantity;
          const existing = aggregated.get(bom.inventory_item_id);
          if (existing) {
            existing.total_required += required;
          } else {
            aggregated.set(bom.inventory_item_id, {
              inventory_item_id: bom.inventory_item_id,
              inventory_item_name: bom.inventory_item?.name ?? bom.inventory_item_id,
              sku: bom.inventory_item?.sku ?? null,
              category: bom.inventory_item?.category ?? null,
              unit_of_measure:
                bom.inventory_item?.unit_of_measure ?? bom.unit_of_measure ?? null,
              total_required: required,
            });
          }
        }
      }

      if (aggregated.size === 0) return [];

      // Step 4: Fetch on-hand quantities
      const itemIds = [...aggregated.keys()];
      const { data: onHand, error: onHandErr } = await dynamicFrom(supabase, "inventory_lots_with_quantities")
        .select("inventory_item_id, quantity_on_hand")
        .in("inventory_item_id", itemIds);
      if (onHandErr) throw onHandErr;

      // Sum on-hand per inventory_item_id (there may be multiple lots)
      const onHandMap = new Map<string, number>();
      for (const row of (onHand ?? []) as unknown as Array<{
        inventory_item_id: string;
        quantity_on_hand: number;
      }>) {
        const prev = onHandMap.get(row.inventory_item_id) ?? 0;
        onHandMap.set(row.inventory_item_id, prev + (row.quantity_on_hand ?? 0));
      }

      // Step 5: Build result sorted by shortfall descending
      const result: SessionMaterialPreview[] = [];
      for (const entry of aggregated.values()) {
        const on_hand_quantity = onHandMap.get(entry.inventory_item_id) ?? 0;
        result.push({
          ...entry,
          on_hand_quantity,
          shortfall: Math.max(0, entry.total_required - on_hand_quantity),
        });
      }

      return result.sort((a, b) => b.shortfall - a.shortfall);
    },
    enabled: !!sessionId,
  });
}
