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
  useState,
  useMemo,
  useCallback,
  type ReactNode,
} from "react";
import type { GrainBillItem } from "@/components/domain/grain-bill-editor";
import type { HopScheduleItem } from "@/components/domain/hop-schedule-editor";
import type { MashStep } from "@/components/domain/mash-schedule-editor";
import type { FermentationStage } from "@/components/domain/fermentation-schedule-editor";
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
  /** Refresh the recipe from the database (e.g., after a version conflict) */
  refreshRecipe: () => void;
  /** Handle save errors with version conflict detection and auto-reload */
  handleSaveError: (error: Error) => void;
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

  const updateRecipe = useCallback((partial: Partial<RecipeData>) => {
    setRecipe((prev) => ({ ...prev, ...partial }));
  }, []);

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

  const refreshRecipe = useCallback(() => {
    onRefresh?.();
  }, [onRefresh]);

  /** Shared error handler for section save mutations with version conflict detection */
  const handleSaveError = useCallback((error: Error) => {
    if (error.message?.includes("version") || error.message?.includes("conflict")) {
      toast.error("Someone else edited this recipe. Reloading...", {
        description: "Your changes were not saved.",
      });
      onRefresh?.();
    } else {
      toast.error(error.message);
    }
  }, [onRefresh]);

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
      refreshRecipe,
      handleSaveError,
    }),
    [recipe, updateRecipe, grainItems, hopItems, estimates, isSaving, startSaving, refreshRecipe, handleSaveError]
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
