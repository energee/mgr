/**
 * Planned-addition completion matching
 *
 * Pure logic for deciding whether a planned recipe addition (dry hop, fruit,
 * spice, adjunct) has already been logged as a batch_additions row. Extracted
 * from PlannedAdditions so it can be unit tested without Supabase/react-query.
 *
 * Matching rules:
 * 1. The logged row's addition_type must map to the planned display type.
 * 2. If both sides carry a catalog item id (hops.id, fruits.id, ...), the ids
 *    decide the match exactly. Note: planned.catalogId is the CATALOG id from
 *    the recipe junction row (recipe_hops.hop_id etc.), not the junction row id.
 * 3. Fuzzy bidirectional name containment is only a fallback for custom-named
 *    entries (rows logged without a catalog link).
 */

import type { AdditionType } from "@/domain/batch-additions";

/** A fermentation addition planned by the recipe (from a recipe junction row). */
export type PlannedAddition = {
  /** Recipe junction row id (recipe_hops.id, recipe_fruits.id, ...) */
  id: string;
  /** Catalog item id (hops.id, fruits.id, spices.id, adjuncts.id) for exact matching/prefill */
  catalogId: string;
  type: AdditionType;
  name: string;
  amount: number;
  unit: string;
  timing?: string;
  notes?: string;
};

/** Minimal shape of a logged batch_additions row needed for matching. */
export type LoggedAdditionRow = {
  addition_type: string;
  catalog_id: string | null;
  name: string;
};

/** Map form/display addition types to the DB addition_type enum values. */
export const DISPLAY_TO_DB_TYPES: Record<string, string[]> = {
  dry_hop: ["hop"],
  fruit: ["fruit"],
  adjunct: ["adjunct"],
  fining: ["other"],
  spice: ["spice"],
  other: ["other"],
};

/**
 * Check whether a planned addition has been logged.
 *
 * Catalog-linked rows match by catalog id; rows logged with a custom name
 * (no catalog_id) fall back to fuzzy bidirectional name containment.
 */
export function isPlannedAdditionLogged(
  planned: PlannedAddition,
  actualAdditions: LoggedAdditionRow[]
): boolean {
  return actualAdditions.some((row) => {
    // Match by mapped type first
    const dbTypes = DISPLAY_TO_DB_TYPES[planned.type] || [planned.type];
    if (!dbTypes.includes(row.addition_type)) return false;

    // When both sides have a catalog id, the ids decide the match exactly
    if (row.catalog_id && planned.catalogId) {
      return row.catalog_id === planned.catalogId;
    }

    // Fuzzy name matching fallback for custom-named (uncatalogued) entries
    const actualName = row.name.toLowerCase();
    const plannedName = planned.name.toLowerCase();
    return actualName.includes(plannedName) || plannedName.includes(actualName);
  });
}
