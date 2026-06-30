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
 * 3. Save via delete-all-then-reinsert keyed on `recipe_id`, re-deriving
 *    `position` from array order.
 * 4. Invalidate the section's query key plus `recipeKeys.detail(recipeId)`.
 *
 * Registration with the recipe editor's saver registry stays in the caller
 * (one `useRegisterSaver(key, Boolean(editing && dirty), save)` line), since
 * that depends on the component-layer RecipeEditorContext.
 */

import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { dynamicFrom } from "@/services/types";
import { recipeKeys } from "@/lib/query-keys";
import { toast } from "sonner";

type UseRecipeChildRowsOptions<Fetched, Row> = {
  /** Parent recipe id; rows are scoped by `recipe_id`. */
  recipeId: string;
  /** Junction table name (e.g. "recipe_malts"). */
  table: string;
  /** Select string for the fetch, including any joined catalog relation. */
  select: string;
  /** Query key for this section (also invalidated after save). */
  queryKey: readonly unknown[];
  /** Human label used in the save-failure toast (e.g. "grain bill"). */
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
  /** Saves if dirty (delete-all + reinsert); safe to register as a saver. */
  save: () => Promise<void>;
  /** Initial fetch in flight. */
  isLoading: boolean;
  /** Save mutation in flight. */
  isPending: boolean;
};

export function useRecipeChildRows<Fetched, Row>({
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
  const queryClient = useQueryClient();

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

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (validate) {
        const message = validate(items);
        if (message) throw new Error(message);
      }

      const { error: deleteError } = await dynamicFrom(supabase, table)
        .delete()
        .eq("recipe_id", recipeId);
      if (deleteError) throw deleteError;

      if (items.length > 0) {
        const { error: insertError } = await dynamicFrom(supabase, table).insert(
          items.map((item, index) => ({
            recipe_id: recipeId,
            ...toInsert(item),
            position: index,
          }))
        );
        if (insertError) throw insertError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: recipeKeys.detail(recipeId) });
      setDirty(false);
    },
    onError: (error) => {
      toast.error(`Failed to save ${errorLabel}: ` + error.message);
    },
  });

  const save = useCallback(async () => {
    if (!dirty) return;
    await saveMutation.mutateAsync();
  }, [dirty, saveMutation]);

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
    save,
    isLoading,
    isPending: saveMutation.isPending,
  };
}
