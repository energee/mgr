/**
 * Material-planning service — the Supabase reads behind packaging/shipping
 * material planning.
 *
 * React-free by construction, so route handlers, AI tools and a future
 * frontend can plan materials without importing a hook. Every function takes
 * an already-constructed `SupabaseClient`, matching the rest of
 * `src/services/`.
 *
 * Split of responsibility (backend-extraction T3.1,
 * `docs/plans/backend-extraction.md`):
 * - `src/domain/material-planning.ts` — the pure BOM math and row shapes,
 * - this file — the reads and the order they happen in,
 * - `src/hooks/use-material-planning.ts` — React-Query wrappers, nothing else.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "@/lib/supabase/query-helpers";
import { dynamicFrom, dynamicRpc } from "@/services/types";
import {
  applyOnHandToRequirements,
  collectSellingFormatIds,
  computeSessionMaterialRequirements,
  type MaterialOnHandRow,
  type MaterialShortfall,
  type OrderMaterial,
  type SellingFormatMaterial,
  type SessionMaterialBomLine,
  type SessionMaterialLineItem,
  type SessionMaterialPreview,
} from "@/domain/material-planning";

/** Display fields joined onto every material row. */
const INVENTORY_ITEM_FIELDS = "id, name, sku, category, unit";

/** Default look-ahead window for `calculate_material_shortfalls`. */
export const DEFAULT_SHORTFALL_HORIZON_WEEKS = 4;

/**
 * Fetch the bill of materials for a selling format, joined to `inventory_items`
 * for display fields.
 */
export async function fetchSellingFormatBOM(
  supabase: SupabaseClient,
  sellingFormatId: string,
): Promise<SellingFormatMaterial[]> {
  const data = await unwrap(
    dynamicFrom(supabase, "selling_format_materials")
      .select(
        `id, selling_format_id, inventory_item_id, quantity_per_unit, notes,
           inventory_item:inventory_items(${INVENTORY_ITEM_FIELDS})`,
      )
      .eq("selling_format_id", sellingFormatId),
  );
  return (data ?? []) as unknown as SellingFormatMaterial[];
}

/**
 * Calculate material shortfalls across all pending demand via the
 * `calculate_material_shortfalls` RPC, which aggregates BOM demand against
 * on-hand inventory.
 *
 * Returns every demand source; narrow with
 * `filterShortfallsByDemandSource` rather than refetching per source.
 */
export async function fetchMaterialShortfalls(
  supabase: SupabaseClient,
  horizonWeeks?: number,
): Promise<MaterialShortfall[]> {
  const data = await unwrap(
    dynamicRpc(supabase, "calculate_material_shortfalls", {
      p_horizon_weeks: horizonWeeks ?? DEFAULT_SHORTFALL_HORIZON_WEEKS,
    }),
  );
  return (data ?? []) as MaterialShortfall[];
}

/**
 * Fetch material requirements for a specific order, joined to
 * `inventory_items` for display fields.
 */
export async function fetchOrderMaterials(
  supabase: SupabaseClient,
  orderId: string,
): Promise<OrderMaterial[]> {
  const data = await unwrap(
    dynamicFrom(supabase, "order_materials")
      .select(
        `id, order_id, inventory_item_id, estimated_qty, actual_qty,
           inventory_item:inventory_items(${INVENTORY_ITEM_FIELDS})`,
      )
      .eq("order_id", orderId),
  );
  return (data ?? []) as unknown as OrderMaterial[];
}

/**
 * Compute the material preview for a packaging session.
 *
 * 1. Read the session's line items (planned quantity, selling format, batch).
 * 2. Read the BOM for the formats those lines reference.
 * 3. Roll requirements up per batch (`computeSessionMaterialRequirements`).
 * 4. Read on-hand lots for the required items.
 * 5. Attach on-hand/shortfall and sort (`applyOnHandToRequirements`).
 *
 * Each step short-circuits to `[]` when it has nothing to work with, so a
 * session with no lines, no formats, or no BOM never issues the later reads.
 */
export async function fetchSessionMaterialPreview(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<SessionMaterialPreview[]> {
  const lineItems = (await unwrap(
    dynamicFrom(supabase, "session_line_items")
      .select("selling_format_id, planned_quantity, batch_id")
      .eq("session_id", sessionId),
  )) as unknown as SessionMaterialLineItem[] | null;
  if (!lineItems || lineItems.length === 0) return [];

  const formatIds = collectSellingFormatIds(lineItems);
  if (formatIds.length === 0) return [];

  const bomRows = (await unwrap(
    dynamicFrom(supabase, "selling_format_materials")
      .select(
        `selling_format_id, inventory_item_id, quantity_per_unit,
           inventory_item:inventory_items(${INVENTORY_ITEM_FIELDS})`,
      )
      .in("selling_format_id", formatIds),
  )) as unknown as SessionMaterialBomLine[] | null;

  const requirements = computeSessionMaterialRequirements(lineItems, bomRows ?? []);
  if (requirements.length === 0) return [];

  const onHand = (await unwrap(
    dynamicFrom(supabase, "inventory_lots_with_quantities")
      .select("inventory_item_id, remaining_quantity")
      .in(
        "inventory_item_id",
        requirements.map((r) => r.inventory_item_id),
      ),
  )) as unknown as MaterialOnHandRow[] | null;

  return applyOnHandToRequirements(requirements, onHand ?? []);
}
