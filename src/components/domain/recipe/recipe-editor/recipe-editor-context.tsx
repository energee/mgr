/**
 * RecipeEditorContext - Shared state for the recipe editor.
 *
 * Holds the recipe record, live grain bill / hop schedule data, and
 * computed estimates (OG, FG, ABV, IBU, SRM). Section components push
 * pre-save data via update callbacks; the sidebar reads computed estimates
 * reactively via useMemo.
 *
 * Also provides save coordination (isSaving / startSaving) to prevent
 * concurrent optimistic-lock conflicts between independent sections.
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
import type { GrainBillItem } from "@/components/domain/recipe/grain-bill-editor";
import type { HopScheduleItem } from "@/components/domain/recipe/hop-schedule-editor";
import type { MashStep } from "@/components/domain/recipe/mash-schedule-editor";
import type { FermentationStage } from "@/components/domain/recipe/fermentation-schedule-editor";
import {
  calculateEstimates,
  type RecipeEstimates,
} from "./recipe-estimate-calc";
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
  /** Mark a section save as started. Returns a callback to mark it complete. */
  startSaving: () => () => void;
  /** Handle save errors with version conflict detection and auto-reload */
  handleSaveError: (error: Error) => void;

  /** Register a section's save callback. Returns an unregister function. */
  registerSaver: (id: string, save: () => Promise<void>) => () => void;
  /** Update a section's dirty state. */
  setSectionDirty: (id: string, isDirty: boolean) => void;
  /** True if any registered section is dirty. */
  anyDirty: boolean;
  /** Save all dirty sections sequentially. */
  saveAll: () => Promise<void>;
  /**
   * Read the latest recipe.version synchronously. Sections must call this
   * inside their mutationFn (rather than reading recipe.version from closure)
   * so saveAll can chain multiple section saves without each subsequent
   * save fighting an out-of-date version captured at render time.
   */
  getVersion: () => number;
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
  const [recipe, setRecipe] = useState<RecipeData>(initialRecipe);
  const [grainItems, setGrainItems] = useState<GrainBillItem[]>([]);
  const [hopItems, setHopItems] = useState<HopScheduleItem[]>([]);
  const [savingCount, setSavingCount] = useState(0);

  // Tracks the latest recipe.version synchronously, independent of React's
  // render cycle. Section mutations must read from here so chained saveAll
  // calls don't collide on stale closure state.
  const versionRef = useRef<number>(initialRecipe.version);

  const updateRecipe = useCallback((partial: Partial<RecipeData>) => {
    if (typeof partial.version === "number") {
      versionRef.current = partial.version;
    }
    setRecipe((prev) => ({ ...prev, ...partial }));
  }, []);

  const getVersion = useCallback(() => versionRef.current, []);

  // Keep versionRef in sync if the parent reloads with a newer recipe
  // (e.g., after a conflict-driven refetch).
  useEffect(() => {
    if (initialRecipe.version !== versionRef.current) {
      versionRef.current = initialRecipe.version;
    }
  }, [initialRecipe.version]);

  /**
   * Mark a section save as started. Returns a cleanup callback
   * that marks the save as complete. Sections should call startSaving()
   * before their mutation and the returned callback in onSettled.
   * Uses functional state updates to avoid race conditions with concurrent saves.
   */
  const startSaving = useCallback(() => {
    setSavingCount(prev => prev + 1);
    return () => {
      setSavingCount(prev => Math.max(0, prev - 1));
    };
  }, []);

  const isSaving = savingCount > 0;

  /** Shared error handler for section save mutations with version conflict detection */
  const handleSaveError = useCallback((error: Error) => {
    const msg = error.message ?? "";
    const isConflict =
      error.name === "ConcurrentModificationError" ||
      msg.includes("version") ||
      msg.includes("conflict") ||
      msg.includes("modified by another user");
    if (isConflict) {
      toast.error("Someone else edited this recipe. Reloading...", {
        description: "Your changes were not saved.",
      });
      onRefresh?.();
    } else {
      toast.error(msg || "Save failed");
    }
  }, [onRefresh]);

  // Saver registry — sections register their save callback so the page-level
  // Save button can run them sequentially. Sequential execution avoids the
  // optimistic-lock race that occurred when each section had its own button.
  const saversRef = useRef(new Map<string, () => Promise<void>>());
  const [dirtyIds, setDirtyIds] = useState<ReadonlySet<string>>(() => new Set());

  const registerSaver = useCallback(
    (id: string, save: () => Promise<void>) => {
      saversRef.current.set(id, save);
      return () => {
        saversRef.current.delete(id);
        setDirtyIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
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
      return next;
    });
  }, []);

  const anyDirty = dirtyIds.size > 0;

  const saveAll = useCallback(async () => {
    const ids = Array.from(saversRef.current.keys());
    for (const id of ids) {
      const save = saversRef.current.get(id);
      if (!save) continue;
      await save();
      // Yield so React can commit pending state updates (notably the recipe
      // version bump) before the next section's save closure is re-read.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }, []);

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
      startSaving,
      handleSaveError,
      registerSaver,
      setSectionDirty,
      anyDirty,
      saveAll,
      getVersion,
    }),
    [
      recipe,
      updateRecipe,
      grainItems,
      hopItems,
      estimates,
      isSaving,
      startSaving,
      handleSaveError,
      registerSaver,
      setSectionDirty,
      anyDirty,
      saveAll,
      getVersion,
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
 * Register a section with the saver registry. The save callback is invoked
 * sequentially by the page-level Save button. The save closure is read at
 * call time via a ref so it always sees the latest state.
 */
export function useRegisterSaver(
  id: string,
  isDirty: boolean,
  save: () => Promise<void>
) {
  const { registerSaver, setSectionDirty } = useRecipeEditor();
  const saveRef = useRef(save);

  useEffect(() => {
    saveRef.current = save;
  });

  useEffect(() => {
    return registerSaver(id, () => saveRef.current());
  }, [id, registerSaver]);

  useEffect(() => {
    setSectionDirty(id, isDirty);
  }, [id, isDirty, setSectionDirty]);
}
