"use client";

/**
 * RecipeIngredientsEditor - Grain Bill & Hop Schedule for Recipe Edit Page
 *
 * Fetches recipe_malts and recipe_hops junction data, renders each in its own
 * Card with the existing GrainBillEditor / HopScheduleEditor components,
 * and saves independently via delete-all + insert-new.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { recipeKeys } from "@/lib/query-keys";
import {
  GrainBillEditor,
  type GrainBillItem,
} from "@/components/domain/grain-bill-editor";
import {
  HopScheduleEditor,
  type HopScheduleItem,
} from "@/components/domain/hop-schedule-editor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Save, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface RecipeIngredientsEditorProps {
  recipeId: string;
  disabled?: boolean;
}

export function RecipeIngredientsEditor({
  recipeId,
  disabled = false,
}: RecipeIngredientsEditorProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  // ── Grain Bill ──────────────────────────────────────────────────────

  const [grainItems, setGrainItems] = useState<GrainBillItem[]>([]);
  const [grainDirty, setGrainDirty] = useState(false);

  const { data: fetchedGrains, isLoading: grainsLoading } = useQuery({
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
            potential_ppg
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

  // Sync fetched data → local state (React recommended pattern)
  const [prevGrains, setPrevGrains] = useState(fetchedGrains);
  if (fetchedGrains && fetchedGrains !== prevGrains) {
    setPrevGrains(fetchedGrains);
    setGrainItems(
      fetchedGrains.map((g) => ({
        id: g.id,
        malt_id: g.malt_id,
        weight_lbs: g.weight_lbs,
        position: g.position,
        malt: g.malts,
      }))
    );
    setGrainDirty(false);
  }

  const handleGrainChange = (items: GrainBillItem[]) => {
    setGrainItems(items);
    setGrainDirty(true);
  };

  const grainSave = useMutation({
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

  // ── Hop Schedule ────────────────────────────────────────────────────

  const [hopItems, setHopItems] = useState<HopScheduleItem[]>([]);
  const [hopDirty, setHopDirty] = useState(false);

  const { data: fetchedHops, isLoading: hopsLoading } = useQuery({
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
            flavor_profile
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

  const [prevHops, setPrevHops] = useState(fetchedHops);
  if (fetchedHops && fetchedHops !== prevHops) {
    setPrevHops(fetchedHops);
    setHopItems(
      fetchedHops.map((h) => ({
        id: h.id,
        hop_id: h.hop_id,
        weight_oz: h.weight_oz,
        timing: h.timing,
        boil_time_min: h.boil_time_min,
        position: h.position,
        hop: h.hops,
      }))
    );
    setHopDirty(false);
  }

  const handleHopChange = (items: HopScheduleItem[]) => {
    setHopItems(items);
    setHopDirty(true);
  };

  const hopSave = useMutation({
    mutationFn: async () => {
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

  // ── Render ──────────────────────────────────────────────────────────

  const isSaving = grainSave.isPending || hopSave.isPending;

  return (
    <div className="space-y-6 mt-6">
      {/* Grain Bill */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Grain Bill</CardTitle>
          {grainDirty && (
            <Button
              type="button"
              size="sm"
              onClick={() => grainSave.mutate()}
              disabled={disabled || grainSave.isPending}
            >
              {grainSave.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save Grain Bill
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {grainsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <GrainBillEditor
              items={grainItems}
              onChange={handleGrainChange}
              disabled={disabled || isSaving}
              recipeId={recipeId}
            />
          )}
        </CardContent>
      </Card>

      {/* Hop Schedule */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Hop Schedule</CardTitle>
          {hopDirty && (
            <Button
              type="button"
              size="sm"
              onClick={() => hopSave.mutate()}
              disabled={disabled || hopSave.isPending}
            >
              {hopSave.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save Hop Schedule
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {hopsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <HopScheduleEditor
              items={hopItems}
              onChange={handleHopChange}
              disabled={disabled || isSaving}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
