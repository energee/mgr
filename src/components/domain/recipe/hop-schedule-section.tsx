"use client";

/**
 * HopScheduleSection - Section wrapper for HopScheduleEditor in recipe detail view.
 *
 * Uses useRecipeChildRows for fetch/dirty state and contributes recipe_hops
 * to the recipe editor's aggregate atomic save.
 * Passes batchSizeGal and estimatedOG to the editor for IBU calculations.
 */

import { useEffect } from "react";
import { recipeKeys } from "@/lib/query-keys";
import { useRecipeChildRows } from "@/hooks/use-recipe-child-rows";
import {
  HopScheduleEditor,
  type HopScheduleItem,
} from "@/components/domain/recipe/hop-schedule-editor";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useRecipeEditor,
  useRegisterSaver,
} from "@/components/domain/recipe/recipe-editor/recipe-editor-context";

/** Barrels to gallons conversion factor */
const BBL_TO_GAL = 31.0;

type HopScheduleSectionProps = {
  data: {
    id: string;
    batch_size_bbl?: number | null;
    est_og?: number | null;
  };
  editing?: boolean;
  /** Optional callback fired with current items after fetch sync or local edits */
  onDataChange?: (items: HopScheduleItem[]) => void;
}

export function HopScheduleSection({ data, editing, onDataChange }: HopScheduleSectionProps) {
  const recipeId = data.id;
  const { isSaving } = useRecipeEditor();

  const batchSizeGal = (data.batch_size_bbl ?? 0) * BBL_TO_GAL || 5;
  const estimatedOG = data.est_og ?? 1.05;

  const { items: hopItems, dirty, update, prepareSave, isLoading } =
    useRecipeChildRows<HopScheduleItem & { hops: HopScheduleItem["hop"] }, HopScheduleItem>({
      recipeId,
      table: "recipe_hops",
      select: `
          id,
          hop_id,
          weight_oz,
          timing,
          boil_time_min,
          position,
          hops (
            id,
            name,
            origin,
            type,
            alpha_acid_typical,
            flavor_profile,
            bag_weight_lbs
          )
        `,
      queryKey: recipeKeys.hopSchedule(recipeId),
      errorLabel: "hop schedule",
      mapRow: (h) => ({
        id: h.id,
        hop_id: h.hop_id,
        weight_oz: h.weight_oz,
        timing: h.timing,
        boil_time_min: h.boil_time_min,
        position: h.position,
        hop: h.hops,
      }),
      toInsert: (item) => ({
        hop_id: item.hop_id,
        weight_oz: item.weight_oz,
        timing: item.timing,
        boil_time_min: item.boil_time_min,
      }),
      // Validate: reject zero or negative weight entries
      validate: (items) => {
        const invalidItems = items.filter((item) => item.weight_oz <= 0);
        if (invalidItems.length === 0) return null;
        const names = invalidItems.map((item) => item.hop?.name || "Unknown").join(", ");
        return `Cannot save hop schedule: ${names} ${invalidItems.length === 1 ? "has" : "have"} zero or negative weight`;
      },
    });

  // Notify parent of data changes via effect (avoids setState-during-render)
  useEffect(() => {
    onDataChange?.(hopItems);
  }, [hopItems, onDataChange]);

  useRegisterSaver("hop-schedule", Boolean(editing && dirty), prepareSave);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <HopScheduleEditor
        items={hopItems}
        onChange={update}
        disabled={!editing || isSaving}
        batchSizeGal={batchSizeGal}
        estimatedOG={estimatedOG}
      />
    </div>
  );
}
