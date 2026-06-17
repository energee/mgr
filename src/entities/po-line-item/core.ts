/**
 * PO Line Item Entity — server-safe core
 *
 * The pure-data half of the PO line item entity: identity, the zod form
 * schema, catalog helpers, relations, and AI metadata. No React imports —
 * safe to import from server route handlers and API routes.
 *
 * PO line items reference catalog items (malt, hop, yeast, etc.) with
 * quantity, unit, and pricing information.
 */

import { z } from "zod";
import type { EntityCoreInput } from "@/types/entity";
import type { Database } from "@/types/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dynamicFrom } from "@/services/types";

export type POLineItem = Database["public"]["Tables"]["po_line_items"]["Row"];

// =============================================================================
// Constants
// =============================================================================

export const CATALOG_TYPES = [
  { value: "malt", label: "Malt" },
  { value: "hop", label: "Hop" },
  { value: "yeast", label: "Yeast" },
  { value: "adjunct", label: "Adjunct" },
  { value: "additive", label: "Additive" },
  { value: "packaging", label: "Packaging" },
  { value: "other", label: "Other" },
] as const;

/**
 * Maps catalog types to their database table names.
 * Note: "other" type uses free-text input (no catalog table).
 */
export const CATALOG_TABLES: Record<string, string> = {
  malt: "malts",
  hop: "hops",
  yeast: "yeasts",
  adjunct: "adjuncts",
  additive: "additives",
  packaging: "selling_formats",
};

/**
 * Returns the human-readable label for a catalog type.
 */
export function getCatalogTypeLabel(type: string): string {
  return CATALOG_TYPES.find((t) => t.value === type)?.label || type;
}

/**
 * Returns true if the catalog type uses free-text input instead of a dropdown.
 */
export function isFreeTextCatalogType(type: string): boolean {
  return type === "other";
}

/**
 * Resolves catalog item names in batch by type.
 *
 * Groups items by catalog_type, resolves free-text types directly,
 * and queries catalog tables in parallel for the rest.
 * Returns a Map keyed by `"catalog_type:catalog_id"` → display name.
 */
export async function resolveCatalogNames(
  supabase: SupabaseClient<Database>,
  items: Array<{ catalog_type: string; catalog_id: string }>,
): Promise<Map<string, string>> {
  const nameMap = new Map<string, string>();
  if (items.length === 0) return nameMap;

  // Group by catalog type
  const itemsByType = new Map<string, string[]>();
  for (const item of items) {
    const existing = itemsByType.get(item.catalog_type) ?? [];
    existing.push(item.catalog_id);
    itemsByType.set(item.catalog_type, existing);
  }

  // Resolve free-text types synchronously
  for (const [catalogType, catalogIds] of itemsByType) {
    if (isFreeTextCatalogType(catalogType)) {
      for (const id of catalogIds) {
        nameMap.set(`${catalogType}:${id}`, id);
      }
    }
  }

  // Resolve catalog names in parallel (one query per type)
  const catalogQueries = Array.from(itemsByType.entries())
    .filter(
      ([catalogType]) =>
        !isFreeTextCatalogType(catalogType) && CATALOG_TABLES[catalogType],
    )
    .map(async ([catalogType, catalogIds]) => {
      const table = CATALOG_TABLES[catalogType];
      const uniqueIds = [...new Set(catalogIds)];
      const { data: catalogItems } = await dynamicFrom(supabase, table)
        .select("id, name")
        .in("id", uniqueIds);
      for (const ci of catalogItems ?? []) {
        nameMap.set(`${catalogType}:${ci.id}`, ci.name);
      }
    });
  await Promise.all(catalogQueries);

  return nameMap;
}

// =============================================================================
// Zod Schema
// =============================================================================

export const poLineItemSchema = z.object({
  po_id: z.string().uuid("Purchase order is required"),
  catalog_type: z.string().min(1, "Catalog type is required"),
  // catalog_id can be UUID (for catalog items) or free-text (for "other" type)
  catalog_id: z.string().min(1, "Item is required"),
  quantity: z.coerce.number().positive("Quantity must be greater than zero"),
  unit: z.string().min(1, "Unit is required"),
  unit_price: z.coerce.number().nullable().optional(),
});

export type POLineItemFormValues = z.infer<typeof poLineItemSchema>;

// =============================================================================
// Entity Core
// =============================================================================

export const poLineItemCore: EntityCoreInput<POLineItem> = {
  name: "po_line_item",
  table: "po_line_items",
  viewTable: "po_line_items_with_quantities",
  displayName: "PO Line Item",
  defaultSort: { column: "created_at", direction: "desc" },
  description: "Purchase order line items for ingredients and materials",
  domain: "purchasing",

  searchableFields: [],

  detailHeader: {
    title: "catalog_type",
  },

  formSchema: poLineItemSchema,

  relations: [
    {
      name: "purchase_order",
      entity: "purchase_order",
      type: "belongsTo",
      foreignKey: "po_id",
      showInDetail: true,
    },
    {
      name: "receives",
      entity: "po_receive",
      type: "hasMany",
      foreignKey: "po_line_item_id",
      showInDetail: true,
      detailTab: "Receives",
    },
  ],

  queryExamples: [
    "Show line items for PO-2025-001",
    "List all malt orders this month",
    "Find hop purchases by price",
  ],

  keyFields: ["po_id", "catalog_type", "catalog_id", "quantity", "unit"],
};
