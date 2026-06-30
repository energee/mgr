/**
 * Supplier Catalog (supplier_catalog) read/write helpers
 *
 * supplier_catalog records "this supplier supplies this item" with price,
 * lead time, MOQ and a preferred-supplier flag. It is polymorphic:
 * (catalog_type, catalog_id) points at a catalog table (malts, hops, ...)
 * or at inventory_items, and carries UNIQUE(supplier_id, catalog_type,
 * catalog_id) (migration 00010) which the upsert here relies on.
 *
 * The shortfall pipeline reads this table to resolve the preferred supplier
 * per item (ingredient shortfalls: migrations 00110/00150; material
 * shortfalls: 00163/00164) using DISTINCT ON ... ORDER BY is_preferred DESC,
 * so `setPreferredSupplier` demotes any other preferred rows for the same
 * item to keep that resolution deterministic.
 *
 * Consumers:
 * - Ingredient Demand page: persists supplier assignments made in
 *   UnassignedShortfallsCard so they survive page visits.
 * - Supplier detail "Catalog Items" tab (SupplierCatalogSection): full
 *   row management (price / lead time / MOQ / preferred).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { dynamicFrom } from "@/services/types";

// =============================================================================
// Constants
// =============================================================================

/** UNIQUE constraint columns on supplier_catalog (migration 00010). */
export const SUPPLIER_CATALOG_CONFLICT = "supplier_id,catalog_type,catalog_id";

/**
 * Catalog types a supplier_catalog row can reference, with display labels.
 * Superset of the PO line-item CATALOG_TYPES brewing types: includes the
 * sugar/spice/fruit catalogs read by the shortfall SQL (00163 catalog_items
 * CTE) plus inventory_item for direct material links (migration 00161).
 */
export const SUPPLIER_CATALOG_TYPES: { value: string; label: string }[] = [
  { value: "malt", label: "Malt" },
  { value: "hop", label: "Hop" },
  { value: "yeast", label: "Yeast" },
  { value: "adjunct", label: "Adjunct" },
  { value: "sugar", label: "Sugar" },
  { value: "spice", label: "Spice" },
  { value: "fruit", label: "Fruit" },
  { value: "additive", label: "Additive" },
  { value: "inventory_item", label: "Inventory Item" },
];

/** Maps supplier catalog types to their database table names. */
export const SUPPLIER_CATALOG_TABLES: Record<string, string> = {
  malt: "malts",
  hop: "hops",
  yeast: "yeasts",
  adjunct: "adjuncts",
  sugar: "sugars",
  spice: "spices",
  fruit: "fruits",
  additive: "additives",
  inventory_item: "inventory_items",
};

/** Display label for a supplier catalog type. */
export function getSupplierCatalogTypeLabel(type: string): string {
  return SUPPLIER_CATALOG_TYPES.find((t) => t.value === type)?.label ?? type;
}

// =============================================================================
// Types
// =============================================================================

export type PreferredSupplierAssignment = {
  supplierId: string;
  catalogType: string;
  catalogId: string;
};

// =============================================================================
// Name resolution
// =============================================================================

/**
 * Resolve display names for supplier_catalog rows in batch (one query per
 * catalog_type). Like po-line-item's resolveCatalogNames but covers the
 * full SUPPLIER_CATALOG_TABLES map (sugar/spice/fruit included). Returns a
 * Map keyed by `"catalog_type:catalog_id"` → name; unknown types are
 * omitted so callers can fall back to the raw id.
 */
export async function resolveSupplierCatalogNames(
  supabase: SupabaseClient<Database>,
  rows: Array<{ catalog_type: string; catalog_id: string }>,
): Promise<Map<string, string>> {
  const nameMap = new Map<string, string>();
  if (rows.length === 0) return nameMap;

  const idsByType = new Map<string, Set<string>>();
  for (const row of rows) {
    const ids = idsByType.get(row.catalog_type) ?? new Set<string>();
    ids.add(row.catalog_id);
    idsByType.set(row.catalog_type, ids);
  }

  await Promise.all(
    Array.from(idsByType.entries())
      .filter(([catalogType]) => SUPPLIER_CATALOG_TABLES[catalogType])
      .map(async ([catalogType, ids]) => {
        const { data } = await dynamicFrom(supabase, SUPPLIER_CATALOG_TABLES[catalogType])
          .select("id, name")
          .in("id", Array.from(ids));
        for (const item of (data ?? []) as { id: string; name: string }[]) {
          nameMap.set(`${catalogType}:${item.id}`, item.name);
        }
      }),
  );

  return nameMap;
}

// =============================================================================
// Writes
// =============================================================================

/**
 * Demote preferred supplier_catalog rows for (catalogType, catalogId) that
 * belong to a different supplier, so at most one supplier ends up preferred
 * per item and the shortfall views' DISTINCT ON resolution is deterministic.
 */
export async function demoteOtherPreferredSuppliers(
  supabase: SupabaseClient<Database>,
  { supplierId, catalogType, catalogId }: PreferredSupplierAssignment,
): Promise<void> {
  const { error } = await supabase
    .from("supplier_catalog")
    .update({ is_preferred: false })
    .eq("catalog_type", catalogType)
    .eq("catalog_id", catalogId)
    .neq("supplier_id", supplierId)
    .eq("is_preferred", true);
  if (error) throw error;
}

/**
 * Persist a supplier as the preferred source for an item. Demotes any other
 * preferred rows for the item, then upserts on the (supplier_id,
 * catalog_type, catalog_id) unique key with is_preferred = true. The upsert
 * payload only carries those columns, so an existing row keeps its
 * price / lead time / MOQ / SKU / notes.
 */
export async function setPreferredSupplier(
  supabase: SupabaseClient<Database>,
  assignment: PreferredSupplierAssignment,
): Promise<void> {
  await demoteOtherPreferredSuppliers(supabase, assignment);

  const { error } = await supabase
    .from("supplier_catalog")
    .upsert(
      {
        supplier_id: assignment.supplierId,
        catalog_type: assignment.catalogType,
        catalog_id: assignment.catalogId,
        is_preferred: true,
      },
      { onConflict: SUPPLIER_CATALOG_CONFLICT },
    );
  if (error) throw error;
}
