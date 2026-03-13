"use client";

/**
 * HopScheduleSection - Section wrapper for HopScheduleEditor in recipe detail view.
 *
 * Fetches recipe_hops junction data, manages local state with dirty tracking,
 * and saves via delete-all + insert-new pattern.
 * Passes batchSizeGal and estimatedOG to the editor for IBU calculations.
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { recipeKeys } from "@/lib/query-keys";
import {
  HopScheduleEditor,
  type HopScheduleItem,
} from "@/components/domain/hop-schedule-editor";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Save, Loader2 } from "lucide-react";
import { toast } from "sonner";

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
  const supabase = createClient();
  const queryClient = useQueryClient();

  const batchSizeGal = (data.batch_size_bbl ?? 0) * BBL_TO_GAL || 5;
  const estimatedOG = data.est_og ?? 1.05;

  const [hopItems, setHopItems] = useState<HopScheduleItem[]>([]);
  const [hopDirty, setHopDirty] = useState(false);

  const { data: fetchedHops, isLoading } = useQuery({
    queryKey: recipeKeys.hopSchedule(recipeId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipe_hops")
        .select(
          `
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
        `
        )
        .eq("recipe_id", recipeId)
        .order("position", { ascending: true });
      if (error) throw error;
      return data as unknown as (HopScheduleItem & {
        hops: HopScheduleItem["hop"];
      })[];
    },
  });

  // Sync fetched data to local state
  const [prevHops, setPrevHops] = useState(fetchedHops);
  if (fetchedHops && fetchedHops !== prevHops) {
    setPrevHops(fetchedHops);
    const mapped = fetchedHops.map((h) => ({
      id: h.id,
      hop_id: h.hop_id,
      weight_oz: h.weight_oz,
      timing: h.timing,
      boil_time_min: h.boil_time_min,
      position: h.position,
      hop: h.hops,
    }));
    setHopItems(mapped);
    setHopDirty(false);
  }

  // Notify parent of data changes via effect (avoids setState-during-render)
  useEffect(() => {
    onDataChange?.(hopItems);
  }, [hopItems, onDataChange]);

  const handleChange = (items: HopScheduleItem[]) => {
    setHopItems(items);
    setHopDirty(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Validate: reject zero or negative weight entries
      const invalidItems = hopItems.filter((item) => item.weight_oz <= 0);
      if (invalidItems.length > 0) {
        const names = invalidItems.map((item) => item.hop?.name || "Unknown").join(", ");
        throw new Error(`Cannot save hop schedule: ${names} ${invalidItems.length === 1 ? "has" : "have"} zero or negative weight`);
      }

      const { error: deleteError } = await supabase
        .from("recipe_hops")
        .delete()
        .eq("recipe_id", recipeId);
      if (deleteError) throw deleteError;

      if (hopItems.length > 0) {
        const insertData = hopItems.map((item, index) => ({
          recipe_id: recipeId,
          hop_id: item.hop_id,
          weight_oz: item.weight_oz,
          timing: item.timing,
          boil_time_min: item.boil_time_min,
          position: index,
        }));
        const { error: insertError } = await supabase
          .from("recipe_hops")
          .insert(insertData);
        if (insertError) throw insertError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: recipeKeys.hopSchedule(recipeId),
      });
      queryClient.invalidateQueries({
        queryKey: recipeKeys.detail(recipeId),
      });
      setHopDirty(false);
      toast.success("Hop schedule saved");
    },
    onError: (error) => {
      toast.error("Failed to save hop schedule: " + error.message);
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
      <HopScheduleEditor
        items={hopItems}
        onChange={handleChange}
        disabled={!editing || saveMutation.isPending}
        batchSizeGal={batchSizeGal}
        estimatedOG={estimatedOG}
      />
      {editing && hopDirty && (
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
            Save Hop Schedule
          </Button>
        </div>
      )}
    </div>
  );
}
