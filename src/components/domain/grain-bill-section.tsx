"use client";

/**
 * GrainBillSection - Section wrapper for GrainBillEditor in recipe detail view.
 *
 * Fetches recipe_malts junction data, manages local state with dirty tracking,
 * and saves via delete-all + insert-new pattern.
 * View mode = read-only editor; Edit mode = interactive editor with save button.
 */

import { useCallback, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { recipeKeys } from "@/lib/query-keys";
import {
  GrainBillEditor,
  type GrainBillItem,
} from "@/components/domain/grain-bill-editor";
import { Skeleton } from "@/components/ui/skeleton";
import { useRegisterSaver } from "@/components/domain/recipe-editor/recipe-editor-context";
import { toast } from "sonner";

type GrainBillSectionProps = {
  data: { id: string };
  editing?: boolean;
  /** Optional callback fired with current items after fetch sync or local edits */
  onDataChange?: (items: GrainBillItem[]) => void;
}

export function GrainBillSection({ data, editing, onDataChange }: GrainBillSectionProps) {
  const recipeId = data.id;
  const supabase = createClient();
  const queryClient = useQueryClient();

  const [grainItems, setGrainItems] = useState<GrainBillItem[]>([]);
  const [grainDirty, setGrainDirty] = useState(false);

  const { data: fetchedGrains, isLoading } = useQuery({
    queryKey: recipeKeys.grainBill(recipeId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipe_malts")
        .select(
          `
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
        `
        )
        .eq("recipe_id", recipeId)
        .order("position", { ascending: true });
      if (error) throw error;
      return data as unknown as (GrainBillItem & {
        malts: GrainBillItem["malt"];
      })[];
    },
  });

  // Sync fetched data to local state
  const [prevGrains, setPrevGrains] = useState(fetchedGrains);
  if (fetchedGrains && fetchedGrains !== prevGrains) {
    setPrevGrains(fetchedGrains);
    const mapped = fetchedGrains.map((g) => ({
      id: g.id,
      malt_id: g.malt_id,
      weight_lbs: g.weight_lbs,
      position: g.position,
      malt: g.malts,
    }));
    setGrainItems(mapped);
    setGrainDirty(false);
  }

  // Notify parent of data changes via effect (avoids setState-during-render)
  useEffect(() => {
    onDataChange?.(grainItems);
  }, [grainItems, onDataChange]);

  const handleChange = (items: GrainBillItem[]) => {
    setGrainItems(items);
    setGrainDirty(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Validate: reject zero or negative weight entries
      const invalidItems = grainItems.filter((item) => item.weight_lbs <= 0);
      if (invalidItems.length > 0) {
        const names = invalidItems.map((item) => item.malt?.name || "Unknown").join(", ");
        throw new Error(`Cannot save grain bill: ${names} ${invalidItems.length === 1 ? "has" : "have"} zero or negative weight`);
      }

      const { error: deleteError } = await supabase
        .from("recipe_malts")
        .delete()
        .eq("recipe_id", recipeId);
      if (deleteError) throw deleteError;

      if (grainItems.length > 0) {
        const insertData = grainItems.map((item, index) => ({
          recipe_id: recipeId,
          malt_id: item.malt_id,
          weight_lbs: item.weight_lbs,
          position: index,
        }));
        const { error: insertError } = await supabase
          .from("recipe_malts")
          .insert(insertData);
        if (insertError) throw insertError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: recipeKeys.grainBill(recipeId),
      });
      queryClient.invalidateQueries({
        queryKey: recipeKeys.detail(recipeId),
      });
      setGrainDirty(false);
    },
    onError: (error) => {
      toast.error("Failed to save grain bill: " + error.message);
    },
  });

  useRegisterSaver("grain-bill", Boolean(editing && grainDirty), useCallback(async () => {
    if (!grainDirty) return;
    await saveMutation.mutateAsync();
  }, [grainDirty, saveMutation]));

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
        onChange={handleChange}
        disabled={!editing || saveMutation.isPending}
      />
    </div>
  );
}
