"use client";

/**
 * GrainBillSection - Section wrapper for GrainBillEditor in recipe detail view.
 *
 * Fetches recipe_malts junction data, manages local state with dirty tracking,
 * and saves via delete-all + insert-new pattern.
 * View mode = read-only editor; Edit mode = interactive editor with save button.
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { recipeKeys } from "@/lib/query-keys";
import {
  GrainBillEditor,
  type GrainBillItem,
} from "@/components/domain/grain-bill-editor";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Save, Loader2 } from "lucide-react";
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
      toast.success("Grain bill saved");
    },
    onError: (error) => {
      toast.error("Failed to save grain bill: " + error.message);
    },
  });

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
      {editing && grainDirty && (
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save Grain Bill
          </Button>
        </div>
      )}
    </div>
  );
}
