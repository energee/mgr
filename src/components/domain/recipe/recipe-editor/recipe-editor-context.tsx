/**
 * RecipeEditorContext - Shared state for the recipe editor.
 *
 * Holds the recipe record, live grain bill / hop schedule data, and
 * computed estimates (OG, FG, ABV, IBU, SRM). Section components push
 * pre-save data via update callbacks; the sidebar reads computed estimates
 * reactively via useMemo.
 *
 * Also coordinates one aggregate, version-checked save for every dirty
 * parent-field and child-row section.
 */

"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useMemo,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { GrainBillItem } from "@/components/domain/recipe/grain-bill-editor";
import type { HopScheduleItem } from "@/components/domain/recipe/hop-schedule-editor";
import type { MashStep } from "@/components/domain/recipe/mash-schedule-editor";
import type { FermentationStage } from "@/components/domain/recipe/fermentation-schedule-editor";
import { createClient } from "@/lib/supabase/client";
import { entityKeys, recipeKeys } from "@/lib/query-keys";
import type { Json } from "@/types/supabase";
import {
  calculateEstimates,
  type RecipeEstimates,
} from "@/domain/recipe-estimate-calc";
import { toast } from "sonner";

// =============================================================================
// Types
// =============================================================================

/** Partial recipe row — fields the context cares about */
export type RecipeData = {
  id: string;
  name: string;
  version: number;
  status: string;
  style_id?: string | null;
  style_name?: string | null;
  brand_id?: string | null;
  yeast_id?: string | null;
  water_profile_id?: string | null;
  target_water_profile_id?: string | null;
  pricing_tier_id?: string | null;
  is_active?: boolean;
  volume_bbl?: number | null;
  batch_size_bbl?: number | null;
  preboil_volume_bbl?: number | null;
  target_ko_volume_bbl?: number | null;
  mash_water_volume_gal?: number | null;
  sparge_water_volume_gal?: number | null;
  boil_time_min?: number | null;
  mash_temp_f?: number | null;
  target_mash_ph?: number | null;
  mash_efficiency?: number | null;
  water_to_grain_ratio?: number | null;
  whirlpool_time_min?: number | null;
  whirlpool_temp_f?: number | null;
  whirlpool_rest_min?: number | null;
  target_ko_temp_f?: number | null;
  target_attenuation?: number | null;
  target_pitching_rate?: number | null;
  fermentation_days?: number | null;
  conditioning_days?: number | null;
  mash_schedule?: MashStep[] | null;
  fermentation_schedule?: FermentationStage[] | null;
  brew_day_notes?: string | null;
  tasting_notes?: string | null;
  development_notes?: string | null;
  description?: string | null;
  // Computed fields from view
  est_og?: number | null;
  est_fg?: number | null;
  est_abv?: number | null;
  est_ibu?: number | null;
  est_srm?: number | null;
  batch_count?: number | null;
};

export type RecipeChildSection =
  | "recipe_malts"
  | "recipe_hops"
  | "recipe_adjuncts"
  | "recipe_sugars"
  | "recipe_spices"
  | "recipe_fruits";

export type RecipeSaveContribution = {
  /** Allowlisted columns on the recipes row. */
  recipePatch?: Record<string, unknown>;
  /** Present child sections are replaced; omitted sections remain unchanged. */
  sections?: Partial<Record<RecipeChildSection, Array<Record<string, unknown>>>>;
  /** Exact query keys owned by this contribution. */
  queryKeys?: ReadonlyArray<readonly unknown[]>;
  /** Reset local dirty state only after the database transaction commits. */
  onCommitted: () => void;
};

type RecipeSavePreparer = () => Promise<RecipeSaveContribution>;

type RecipeEditorContextValue = {
  recipe: RecipeData;
  /** Update recipe data (for form field changes before save) */
  updateRecipe: (partial: Partial<RecipeData>) => void;

  /** Current grain bill items (pre-save state from GrainBillSection) */
  grainItems: GrainBillItem[];
  setGrainItems: (items: GrainBillItem[]) => void;

  /** Current hop schedule items (pre-save state from HopScheduleSection) */
  hopItems: HopScheduleItem[];
  setHopItems: (items: HopScheduleItem[]) => void;

  /** Live-computed estimates from current editor state */
  estimates: RecipeEstimates;

  /**
   * Whether any section save is currently in progress.
   * Sections should disable their save buttons when this is true
   * to prevent concurrent optimistic-lock conflicts.
   */
  isSaving: boolean;
  /** Register a section's atomic-save contribution. */
  registerSaver: (id: string, prepare: RecipeSavePreparer) => () => void;
  /** Update a section's dirty state. */
  setSectionDirty: (id: string, isDirty: boolean) => void;
  /** True if any registered section is dirty. */
  anyDirty: boolean;
  /** Save all dirty sections in one database transaction. */
  saveAll: () => Promise<void>;
};

// =============================================================================
// Context
// =============================================================================

const RecipeEditorContext = createContext<RecipeEditorContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

type RecipeEditorProviderProps = {
  initialRecipe: RecipeData;
  /** Callback to reload recipe from the database */
  onRefresh?: () => void;
  children: ReactNode;
};

export function RecipeEditorProvider({
  initialRecipe,
  onRefresh,
  children,
}: RecipeEditorProviderProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [recipe, setRecipe] = useState<RecipeData>(initialRecipe);
  const [grainItems, setGrainItems] = useState<GrainBillItem[]>([]);
  const [hopItems, setHopItems] = useState<HopScheduleItem[]>([]);
  const [savingCount, setSavingCount] = useState(0);

  // Tracks the database version synchronously so a conflict-driven parent
  // refetch can update the next aggregate save without discarding local forms.
  const versionRef = useRef<number>(initialRecipe.version);

  const updateRecipe = useCallback((partial: Partial<RecipeData>) => {
    if (typeof partial.version === "number") {
      versionRef.current = partial.version;
    }
    setRecipe((prev) => ({ ...prev, ...partial }));
  }, []);

  // Keep versionRef in sync if the parent reloads with a newer recipe
  // (e.g., after a conflict-driven refetch).
  useEffect(() => {
    if (initialRecipe.version !== versionRef.current) {
      versionRef.current = initialRecipe.version;
    }
  }, [initialRecipe.version]);

  /**
   * Mark the aggregate save as started and return its cleanup callback.
   * Functional updates also guard against a double-click before React renders.
   */
  const startSaving = useCallback(() => {
    setSavingCount(prev => prev + 1);
    return () => {
      setSavingCount(prev => Math.max(0, prev - 1));
    };
  }, []);

  const isSaving = savingCount > 0;

  /** Shared error handler with version-conflict detection. */
  const handleSaveError = useCallback((error: Error) => {
    const msg = error.message ?? "";
    const isConflict =
      msg.includes("version") ||
      msg.includes("conflict") ||
      msg.includes("modified by another user");
    if (isConflict) {
      toast.error("Someone else edited this recipe.", {
        description: "Your local changes are still here. Review them and save again.",
      });
      onRefresh?.();
    } else {
      toast.error(msg || "Save failed");
    }
  }, [onRefresh]);

  // Contribution registry — dirty sections take a snapshot, then one RPC
  // commits every parent field and child collection together.
  const saversRef = useRef(new Map<string, RecipeSavePreparer>());
  const dirtyIdsRef = useRef<ReadonlySet<string>>(new Set());
  const [dirtyIds, setDirtyIds] = useState<ReadonlySet<string>>(() => new Set());

  const registerSaver = useCallback(
    (id: string, prepare: RecipeSavePreparer) => {
      saversRef.current.set(id, prepare);
      return () => {
        saversRef.current.delete(id);
        setDirtyIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          dirtyIdsRef.current = next;
          return next;
        });
      };
    },
    []
  );

  const setSectionDirty = useCallback((id: string, isDirty: boolean) => {
    setDirtyIds((prev) => {
      if (prev.has(id) === isDirty) return prev;
      const next = new Set(prev);
      if (isDirty) next.add(id);
      else next.delete(id);
      dirtyIdsRef.current = next;
      return next;
    });
  }, []);

  const anyDirty = dirtyIds.size > 0;

  const saveAll = useCallback(async () => {
    const ids = Array.from(dirtyIdsRef.current);
    if (ids.length === 0) return;

    const contributions: RecipeSaveContribution[] = [];
    const recipePatch: Record<string, unknown> = {};
    const sections: Partial<
      Record<RecipeChildSection, Array<Record<string, unknown>>>
    > = {};

    try {
      for (const id of ids) {
        const prepare = saversRef.current.get(id);
        if (!prepare) continue;
        const contribution = await prepare();
        Object.assign(recipePatch, contribution.recipePatch);
        for (const [section, rows] of Object.entries(contribution.sections ?? {})) {
          const key = section as RecipeChildSection;
          if (sections[key]) {
            throw new Error(`Recipe section registered more than once: ${key}`);
          }
          sections[key] = rows;
        }
        contributions.push(contribution);
      }
    } catch (error) {
      const preparationError = error instanceof Error ? error : new Error(String(error));
      handleSaveError(preparationError);
      throw preparationError;
    }
    if (contributions.length === 0) return;

    const stopSaving = startSaving();
    try {
      const { data, error } = await supabase.rpc("save_recipe_aggregate_atomic", {
        p_recipe_id: recipe.id,
        p_expected_version: versionRef.current,
        p_recipe_patch: recipePatch as Json,
        p_sections: sections as Json,
      });
      if (error) {
        throw Object.assign(new Error(error.message), error);
      }

      const result = data as { version?: number } | null;
      if (typeof result?.version !== "number") {
        throw new Error("Atomic recipe save returned no committed version");
      }

      versionRef.current = result.version;
      setRecipe((prev) => ({
        ...prev,
        ...recipePatch,
        version: result.version!,
      }));
      for (const contribution of contributions) contribution.onCommitted();

      const committedIds = new Set(ids);
      setDirtyIds((prev) => {
        const next = new Set(Array.from(prev).filter((id) => !committedIds.has(id)));
        dirtyIdsRef.current = next;
        return next;
      });

      await queryClient.invalidateQueries({
        queryKey: recipeKeys.detail(recipe.id),
        exact: true,
      });
      await queryClient.invalidateQueries({
        queryKey: entityKeys.detail("recipes_with_estimates", recipe.id),
        exact: true,
      });
      const queryKeys = contributions.flatMap((contribution) => contribution.queryKeys ?? []);
      await Promise.all(
        queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey, exact: true })),
      );
    } catch (error) {
      const saveError = error instanceof Error ? error : new Error(String(error));
      handleSaveError(saveError);
      throw saveError;
    } finally {
      stopSaving();
    }
  }, [handleSaveError, queryClient, recipe.id, startSaving, supabase]);

  // Compute estimates reactively from current editor state
  const estimates = useMemo<RecipeEstimates>(() => {
    return calculateEstimates({
      grainItems: grainItems.map((g) => ({
        weight_lbs: g.weight_lbs,
        potential_ppg: g.malt?.potential_ppg ?? null,
        color_lovibond: g.malt?.color_lovibond ?? null,
      })),
      hopItems: hopItems.map((h) => ({
        weight_oz: h.weight_oz,
        alpha_acid: h.hop?.alpha_acid_typical ?? null,
        timing: h.timing,
        boil_time_min: h.boil_time_min,
      })),
      batchSizeBbl: recipe.batch_size_bbl,
      volumeBbl: recipe.volume_bbl,
      mashEfficiency: recipe.mash_efficiency,
      targetAttenuation: recipe.target_attenuation,
    });
  }, [grainItems, hopItems, recipe.batch_size_bbl, recipe.volume_bbl, recipe.mash_efficiency, recipe.target_attenuation]);

  const value = useMemo<RecipeEditorContextValue>(
    () => ({
      recipe,
      updateRecipe,
      grainItems,
      setGrainItems,
      hopItems,
      setHopItems,
      estimates,
      isSaving,
      registerSaver,
      setSectionDirty,
      anyDirty,
      saveAll,
    }),
    [
      recipe,
      updateRecipe,
      grainItems,
      hopItems,
      estimates,
      isSaving,
      registerSaver,
      setSectionDirty,
      anyDirty,
      saveAll,
    ]
  );

  return (
    <RecipeEditorContext.Provider value={value}>
      {children}
    </RecipeEditorContext.Provider>
  );
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Access the recipe editor context.
 * Must be used within a RecipeEditorProvider.
 */
export function useRecipeEditor(): RecipeEditorContextValue {
  const ctx = useContext(RecipeEditorContext);
  if (!ctx) {
    throw new Error("useRecipeEditor must be used within a RecipeEditorProvider");
  }
  return ctx;
}

/**
 * Register a section with the atomic-save registry. The prepare closure is
 * read at save time so it snapshots the latest form or child-row state.
 */
export function useRegisterSaver(
  id: string,
  isDirty: boolean,
  prepare: RecipeSavePreparer
) {
  const { registerSaver, setSectionDirty } = useRecipeEditor();
  const prepareRef = useRef(prepare);

  useEffect(() => {
    prepareRef.current = prepare;
  });

  useEffect(() => {
    return registerSaver(id, () => prepareRef.current());
  }, [id, registerSaver]);

  useEffect(() => {
    setSectionDirty(id, isDirty);
  }, [id, isDirty, setSectionDirty]);
}
