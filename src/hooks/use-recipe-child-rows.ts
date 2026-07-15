"use client";

/**
 * useRecipeChildRows - Shared state machine for recipe child-row sections.
 *
 * Encapsulates the pattern repeated by recipe junction-table editors
 * (grain bill, hop schedule, adjuncts/sugars/spices/fruits tabs):
 *
 * 1. Fetch child rows for a recipe ordered by `position`.
 * 2. Mirror the fetched rows into local `items` state with a `dirty` flag,
 *    using a render-time sync (setPrev pattern) so edits are kept until the
 *    query result actually changes.
 * 3. Contribute a stable-id row snapshot to the editor's aggregate RPC.
 * 4. Reset dirty state only after the aggregate transaction commits.
 *
 * Registration with the recipe editor's saver registry stays in the caller
 * (one `useRegisterSaver(key, Boolean(editing && dirty), prepareSave)` line), since
 * that depends on the component-layer RecipeEditorContext.
 */

import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { dynamicFrom } from "@/services/types";
import type {
  RecipeChildSection,
  RecipeSaveContribution,
} from "@/components/domain/recipe/recipe-editor/recipe-editor-context";

type UseRecipeChildRowsOptions<Fetched, Row extends { id?: string }> = {
  /** Parent recipe id; rows are scoped by `recipe_id`. */
  recipeId: string;
  /** Junction table name (e.g. "recipe_malts"). */
  table: RecipeChildSection;
  /** Select string for the fetch, including any joined catalog relation. */
  select: string;
  /** Query key for this section (also invalidated after save). */
  queryKey: readonly unknown[];
  /** Human label used in pre-save validation errors (e.g. "grain bill"). */
  errorLabel: string;
  /** Maps a fetched row (with joined relation) to the local item shape. */
  mapRow: (row: Fetched) => Row;
  /**
   * Maps a local item to its insert payload. `recipe_id` and `position`
   * (array index) are added by the hook.
   */
  toInsert: (item: Row) => Record<string, unknown>;
  /** Optional pre-save validation; return an error message to abort. */
  validate?: (items: Row[]) => string | null;
};

type UseRecipeChildRowsResult<Row> = {
  /** Current local rows (synced from the query, then locally edited). */
  items: Row[];
  /** Raw state setter; callers must set `dirty` themselves via `setDirty`. */
  setItems: React.Dispatch<React.SetStateAction<Row[]>>;
  /** True when local edits have not been saved. */
  dirty: boolean;
  setDirty: React.Dispatch<React.SetStateAction<boolean>>;
  /** Replace items and mark dirty (the common edit path). */
  update: (items: Row[]) => void;
  /** Snapshot rows for the recipe editor's one aggregate transaction. */
  prepareSave: () => Promise<RecipeSaveContribution>;
  /** Initial fetch in flight. */
  isLoading: boolean;
};

export function useRecipeChildRows<Fetched, Row extends { id?: string }>({
  recipeId,
  table,
  select,
  queryKey,
  errorLabel,
  mapRow,
  toInsert,
  validate,
}: UseRecipeChildRowsOptions<Fetched, Row>): UseRecipeChildRowsResult<Row> {
  const supabase = createClient();

  const [items, setItems] = useState<Row[]>([]);
  const [dirty, setDirty] = useState(false);

  const { data: fetched, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await dynamicFrom(supabase, table)
        .select(select)
        .eq("recipe_id", recipeId)
        .order("position", { ascending: true });
      if (error) throw error;
      return data as unknown as Fetched[];
    },
  });

  // Sync fetched data to local state at render time (avoids setState-in-effect lag)
  const [prev, setPrev] = useState(fetched);
  if (fetched && fetched !== prev) {
    setPrev(fetched);
    setItems(fetched.map(mapRow));
    setDirty(false);
  }

  const prepareSave = useCallback(async (): Promise<RecipeSaveContribution> => {
    if (validate) {
      const message = validate(items);
      if (message) throw new Error(message);
    }
    const rows = items.map((item) => {
      if (!item.id) {
        throw new Error(`Failed to save ${errorLabel}: a row has no stable id`);
      }
      return { id: item.id, ...toInsert(item) };
    });
    return {
      sections: { [table]: rows },
      queryKeys: [queryKey],
      onCommitted: () => setDirty(false),
    };
  }, [errorLabel, items, queryKey, table, toInsert, validate]);

  const update = useCallback((next: Row[]) => {
    setItems(next);
    setDirty(true);
  }, []);

  return {
    items,
    setItems,
    dirty,
    setDirty,
    update,
    prepareSave,
    isLoading,
  };
}
