/**
 * Shared report utilities used across batch-cost and COGS report pages.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

/** Individual ingredient allocation cost for a batch */
export type IngredientCostRow = {
  allocation_id: string;
  ingredient_name: string;
  quantity: number;
  unit_cost: number | null;
  total_cost: number;
  lot_number: string | null;
}

/**
 * Fetches ingredient-level cost detail for a single batch from allocations,
 * resolving inventory lot names via inventory_items.
 */
export async function fetchBatchIngredientDetail(
  supabase: SupabaseClient<Database>,
  batchId: string | null
): Promise<IngredientCostRow[]> {
  if (!batchId) return [];

  const { data: allocations, error: allocErr } = await supabase
    .from("allocations")
    .select("id, quantity, unit_cost, source_id, source_type, lot_number")
    .eq("destination_type", "batch")
    .eq("destination_id", batchId)
    .in("status", ["completed", "planned"]);

  if (allocErr) throw allocErr;
  if (!allocations || allocations.length === 0) return [];

  const lotIds = [
    ...new Set(
      allocations
        .filter((a) => a.source_type === "inventory_lot" && a.source_id)
        .map((a) => a.source_id!)
    ),
  ];

  const lotNameMap = new Map<string, string>();

  if (lotIds.length > 0) {
    const { data: lots } = await supabase
      .from("inventory_lots")
      .select("id, inventory_item:inventory_items(name)")
      .in("id", lotIds);

    if (lots) {
      for (const lot of lots) {
        const item = lot.inventory_item as { name: string } | null;
        if (item) {
          lotNameMap.set(lot.id, item.name);
        }
      }
    }
  }

  return allocations.map((a) => ({
    allocation_id: a.id,
    ingredient_name:
      a.source_id && lotNameMap.has(a.source_id)
        ? lotNameMap.get(a.source_id)!
        : a.source_type === "external"
          ? "External"
          : "Unknown",
    quantity: a.quantity,
    unit_cost: a.unit_cost,
    total_cost: a.quantity * (a.unit_cost ?? 0),
    lot_number: a.lot_number,
  }));
}
