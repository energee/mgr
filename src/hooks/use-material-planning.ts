/**
 * Material planning hooks — data fetching for BOM, shortfalls, order materials,
 * and session material previews used by the packaging material planning UI.
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { unwrap } from "@/lib/supabase/query-helpers";
import { dynamicFrom, dynamicRpc } from "@/services/types";
import { materialPlanningKeys } from "@/lib/query-keys";
import { isWholeUnit, ratioFromDecimal } from "@/domain/inventory-units";

// =============================================================================
// Types
// =============================================================================

/** A single line item in a selling format's bill of materials. */
export type SellingFormatMaterial = {
  id: string;
  selling_format_id: string;
  inventory_item_id: string;
  quantity_per_unit: number;
  notes: string | null;
  inventory_item: {
    id: string;
    name: string;
    sku: string | null;
    category: string | null;
    unit: string | null;
  } | null;
};

/**
 * A material shortfall row from calculate_material_shortfalls().
 * Covers brewing ingredients, packaging materials, and shipping materials.
 */
export type MaterialShortfall = {
  inventory_item_id: string;
  inventory_item_name: string;
  category: string | null;
  demand_source: string | null;
  needed_by_date: string | null;
  quantity_needed: number;
  on_hand: number;
  incoming_po: number;
  shortfall: number;
  unit: string | null;
  best_supplier_id: string | null;
  best_supplier_name: string | null;
  lead_time_days: number | null;
  drop_dead_date: string | null;
  is_past_due: boolean;
  source_count: number;
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
    unit: string | null;
  } | null;
};

/**
 * Aggregated material preview for a packaging session, display-ready.
 *
 * Whole-unit rows (each, case) have `total_required` ceiled and
 * `on_hand_quantity` floored — fractional consumption is meaningless for
 * trays/lids/etc. Bulk rows retain decimal precision.
 */
export type SessionMaterialPreview = {
  inventory_item_id: string;
  inventory_item_name: string;
  sku: string | null;
  category: string | null;
  unit: string | null;
  total_required: number;
  on_hand_quantity: number;
  shortfall: number;
  is_whole_unit: boolean;
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
      const data = await unwrap(
        dynamicFrom(supabase, "selling_format_materials")
          .select(
            `id, selling_format_id, inventory_item_id, quantity_per_unit, notes,
           inventory_item:inventory_items(id, name, sku, category, unit)`
          )
          .eq("selling_format_id", sellingFormatId!)
      );
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
  // Cache key excludes demandSource — all source variants share one RPC response
  // per horizon. Client-side filtering via `select` avoids redundant fetches.
  return useQuery({
    queryKey: materialPlanningKeys.shortfalls({ horizonWeeks }),
    queryFn: async (): Promise<MaterialShortfall[]> => {
      const data = await unwrap(
        dynamicRpc(supabase, "calculate_material_shortfalls", {
          p_horizon_weeks: horizonWeeks ?? 4,
        })
      );
      return (data ?? []) as MaterialShortfall[];
    },
    select: (data) => {
      if (demandSource && demandSource !== "all") {
        return data.filter((r) => r.demand_source === demandSource);
      }
      return data;
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
      const data = await unwrap(
        dynamicFrom(supabase, "order_materials")
          .select(
            `id, order_id, inventory_item_id, estimated_qty, actual_qty,
           inventory_item:inventory_items(id, name, sku, category, unit)`
          )
          .eq("order_id", orderId!)
      );
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
 * 3. Aggregate required quantity per (batch, inventory_item), then ceil each
 *    batch's whole-unit need before summing across batches — matching the
 *    completion path's per-batch consumption (M8). Whole-unit rows use exact
 *    integer math from the recovered BOM ratio (avoids 4-decimal drift).
 * 4. Fetch on-hand quantities from inventory_lots_with_quantities.
 * 5. Floor whole-unit on-hand so consumers render integers directly. Return
 *    items sorted by shortfall descending.
 */
export function useSessionMaterialPreview(sessionId: string | null) {
  const supabase = createClient();
  return useQuery({
    queryKey: materialPlanningKeys.sessionMaterials(sessionId ?? ""),
    queryFn: async (): Promise<SessionMaterialPreview[]> => {
      // Step 1: Get line items for session
      const { data: lineItems, error: lineErr } = await dynamicFrom(supabase, "session_line_items")
        .select("selling_format_id, planned_quantity, batch_id")
        .eq("session_id", sessionId!);
      if (lineErr) throw lineErr;
      if (!lineItems || lineItems.length === 0) return [];

      const typedLineItems = lineItems as unknown as Array<{
        selling_format_id: string | null;
        planned_quantity: number | null;
        batch_id: string | null;
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
          `selling_format_id, inventory_item_id, quantity_per_unit,
           inventory_item:inventory_items(id, name, sku, category, unit)`
        )
        .in("selling_format_id", formatIds);
      if (bomErr) throw bomErr;

      const typedBOM = (bomRows ?? []) as unknown as Array<{
        selling_format_id: string;
        inventory_item_id: string;
        quantity_per_unit: number;
        inventory_item: {
          id: string;
          name: string;
          sku: string | null;
          category: string | null;
          unit: string | null;
        } | null;
      }>;

      // Step 3: Aggregate required quantities per (batch, inventory_item).
      //
      // For whole-unit materials (each, case) where we can recover a clean
      // integer ratio from the stored decimal (`1/24` from `0.0417`), use
      // integer arithmetic to avoid precision drift across many line items —
      // otherwise 4800 cans × 0.0417 sums to 200.16 and ceil → 201 trays.
      type AggEntry = {
        inventory_item_id: string;
        inventory_item_name: string;
        sku: string | null;
        category: string | null;
        unit: string | null;
        total_required: number;
        is_whole_unit: boolean;
      };
      // Pre-index BOM by selling_format_id for O(1) lookup. Whole/ratio are
      // loop-invariant per BOM row, so precompute alongside the index.
      type BomEntry = typeof typedBOM[number] & {
        _whole: boolean;
        _ratio: { numerator: number; denominator: number } | null;
      };
      const bomByFormat = new Map<string, BomEntry[]>();
      for (const bom of typedBOM) {
        const _whole = isWholeUnit(bom.inventory_item?.unit ?? null);
        const enriched: BomEntry = {
          ...bom,
          _whole,
          _ratio: _whole ? ratioFromDecimal(bom.quantity_per_unit) : null,
        };
        const existing = bomByFormat.get(bom.selling_format_id);
        if (existing) {
          existing.push(enriched);
        } else {
          bomByFormat.set(bom.selling_format_id, [enriched]);
        }
      }

      // Accumulate raw required quantity per (batch, inventory_item). Whole-unit
      // materials are ceiled PER BATCH before summing (below), mirroring the
      // completion path: consumePackagingMaterials
      // (src/services/consumption-service.ts) groups line items by batch and
      // ceils each batch's whole-unit need on its own, because a partial
      // case/tray cannot be shared across two different batches. Bulk materials
      // just sum. (M8: per-batch is the canonical ceiling semantic.)
      const perBatch = new Map<string, Map<string, number>>();
      const itemMeta = new Map<string, Omit<AggEntry, "total_required">>();
      for (const li of typedLineItems) {
        if (!li.selling_format_id || li.planned_quantity == null) continue;
        const batchKey = li.batch_id ?? "nobatch";
        let byItem = perBatch.get(batchKey);
        if (!byItem) {
          byItem = new Map<string, number>();
          perBatch.set(batchKey, byItem);
        }
        for (const bom of bomByFormat.get(li.selling_format_id) ?? []) {
          const required = bom._ratio
            ? (li.planned_quantity * bom._ratio.numerator) / bom._ratio.denominator
            : bom.quantity_per_unit * li.planned_quantity;
          byItem.set(
            bom.inventory_item_id,
            (byItem.get(bom.inventory_item_id) ?? 0) + required,
          );
          if (!itemMeta.has(bom.inventory_item_id)) {
            itemMeta.set(bom.inventory_item_id, {
              inventory_item_id: bom.inventory_item_id,
              inventory_item_name: bom.inventory_item?.name ?? bom.inventory_item_id,
              sku: bom.inventory_item?.sku ?? null,
              category: bom.inventory_item?.category ?? null,
              unit: bom.inventory_item?.unit ?? null,
              is_whole_unit: bom._whole,
            });
          }
        }
      }

      // Collapse to per-item totals: ceil each batch's whole-unit contribution
      // (Math.ceil(raw - 1e-9) matches computeBomConsumption), then sum across
      // batches. Bulk contributions sum unchanged.
      const aggregated = new Map<string, AggEntry>();
      for (const byItem of perBatch.values()) {
        for (const [itemId, raw] of byItem) {
          const meta = itemMeta.get(itemId)!;
          const contribution = meta.is_whole_unit ? Math.ceil(raw - 1e-9) : raw;
          const existing = aggregated.get(itemId);
          if (existing) {
            existing.total_required += contribution;
          } else {
            aggregated.set(itemId, { ...meta, total_required: contribution });
          }
        }
      }

      if (aggregated.size === 0) return [];

      // Step 4: Fetch on-hand quantities
      const itemIds = [...aggregated.keys()];
      const { data: onHand, error: onHandErr } = await dynamicFrom(supabase, "inventory_lots_with_quantities")
        .select("inventory_item_id, remaining_quantity")
        .in("inventory_item_id", itemIds);
      if (onHandErr) throw onHandErr;

      // Sum on-hand per inventory_item_id (there may be multiple lots)
      const onHandMap = new Map<string, number>();
      for (const row of (onHand ?? []) as unknown as Array<{
        inventory_item_id: string;
        remaining_quantity: number;
      }>) {
        const prev = onHandMap.get(row.inventory_item_id) ?? 0;
        onHandMap.set(row.inventory_item_id, prev + (row.remaining_quantity ?? 0));
      }

      // Step 5: Build result sorted by shortfall descending. total_required is
      // already per-batch-ceiled above; only on-hand needs flooring for
      // whole-unit materials so consumers render integers directly.
      const result: SessionMaterialPreview[] = [];
      for (const entry of aggregated.values()) {
        const onHandRaw = onHandMap.get(entry.inventory_item_id) ?? 0;
        const on_hand_quantity = entry.is_whole_unit
          ? Math.floor(onHandRaw)
          : onHandRaw;
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
