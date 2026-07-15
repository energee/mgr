"use client";

/**
 * GrainBillSection - Section wrapper for GrainBillEditor in recipe detail view.
 *
 * Uses useRecipeChildRows for fetch/dirty state and contributes recipe_malts
 * to the recipe editor's aggregate atomic save.
 * View mode = read-only editor; Edit mode = interactive editor with save button.
 */

import { useEffect } from "react";
import { recipeKeys } from "@/lib/query-keys";
import { useRecipeChildRows } from "@/hooks/use-recipe-child-rows";
import {
  GrainBillEditor,
  type GrainBillItem,
} from "@/components/domain/recipe/grain-bill-editor";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useRecipeEditor,
  useRegisterSaver,
} from "@/components/domain/recipe/recipe-editor/recipe-editor-context";

type GrainBillSectionProps = {
  data: { id: string };
  editing?: boolean;
  /** Optional callback fired with current items after fetch sync or local edits */
  onDataChange?: (items: GrainBillItem[]) => void;
}

export function GrainBillSection({ data, editing, onDataChange }: GrainBillSectionProps) {
  const recipeId = data.id;
  const { isSaving } = useRecipeEditor();

  const { items: grainItems, dirty, update, prepareSave, isLoading } =
    useRecipeChildRows<GrainBillItem & { malts: GrainBillItem["malt"] }, GrainBillItem>({
      recipeId,
      table: "recipe_malts",
      select: `
          id,
          malt_id,
          weight_lbs,
          position,
          malts (
            id,
            name,
            maltster,
            type,
            color_lovibond,
            potential_ppg,
            bag_weight_lbs
          )
        `,
      queryKey: recipeKeys.grainBill(recipeId),
      errorLabel: "grain bill",
      mapRow: (g) => ({
        id: g.id,
        malt_id: g.malt_id,
        weight_lbs: g.weight_lbs,
        position: g.position,
        malt: g.malts,
      }),
      toInsert: (item) => ({
        malt_id: item.malt_id,
        weight_lbs: item.weight_lbs,
      }),
      // Validate: reject zero or negative weight entries
      validate: (items) => {
        const invalidItems = items.filter((item) => item.weight_lbs <= 0);
        if (invalidItems.length === 0) return null;
        const names = invalidItems.map((item) => item.malt?.name || "Unknown").join(", ");
        return `Cannot save grain bill: ${names} ${invalidItems.length === 1 ? "has" : "have"} zero or negative weight`;
      },
    });

  // Notify parent of data changes via effect (avoids setState-during-render)
  useEffect(() => {
    onDataChange?.(grainItems);
  }, [grainItems, onDataChange]);

  useRegisterSaver("grain-bill", Boolean(editing && dirty), prepareSave);

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
      <GrainBillEditor
        items={grainItems}
        onChange={update}
        disabled={!editing || isSaving}
      />
    </div>
  );
}
