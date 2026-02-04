"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { recipeKeys, entityKeys } from "@/lib/query-keys";
import { useRecipeAutoSave, type SaveStatus } from "@/hooks/use-recipe-autosave";
import { useJunctionTable } from "@/hooks/use-junction-table";
import { ArrowLeft, Copy, Trash2, Check, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, MoreVertical } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { RecipeBuilderBasics } from "@/components/domain/recipe-builder-basics";
import { RecipeBuilderProcess } from "@/components/domain/recipe-builder-process";
import { RecipeBuilderNotes } from "@/components/domain/recipe-builder-notes";
import { RecipeBuilderSidebar } from "@/components/domain/recipe-builder-sidebar";
import { GrainBillEditor, type GrainBillItem } from "@/components/domain/grain-bill-editor";
import { HopScheduleEditor, type HopScheduleItem } from "@/components/domain/hop-schedule-editor";
import { YeastSelector, type YeastItem } from "@/components/domain/yeast-selector";
import { MashScheduleEditor, type MashStep } from "@/components/domain/mash-schedule-editor";
import {
  FermentationScheduleEditor,
  type FermentationStage,
} from "@/components/domain/fermentation-schedule-editor";
import { RecipeCloneDialog } from "@/components/domain/recipe-clone-dialog";
import { RecipeDeleteDialog } from "@/components/domain/recipe-delete-dialog";

import type { Database } from "@/types/supabase";

type RecipeRow = Database["public"]["Tables"]["recipes"]["Row"];

// ---------------------------------------------------------------------------
// Save Status Indicator
// ---------------------------------------------------------------------------

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === "idle") return null;
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {status === "pending" && "Unsaved changes"}
      {status === "saving" && (
        <>
          <Loader2 className="h-3 w-3 animate-spin" />
          Saving...
        </>
      )}
      {status === "saved" && (
        <>
          <Check className="h-3 w-3 text-green-500" />
          Saved
        </>
      )}
      {status === "error" && (
        <>
          <AlertCircle className="h-3 w-3 text-destructive" />
          <span className="text-destructive">Save failed</span>
        </>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Collapsible Section Wrapper
// ---------------------------------------------------------------------------

interface BuilderSectionProps {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function BuilderSection({
  title,
  summary,
  defaultOpen = true,
  children,
}: BuilderSectionProps) {
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <div className="rounded-lg border bg-card">
        <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-3 hover:bg-accent/50 transition-colors">
          <div>
            <div className="text-sm font-semibold text-left">{title}</div>
            {summary && (
              <div className="text-xs text-muted-foreground text-left">
                {summary}
              </div>
            )}
          </div>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-4 pb-4 pt-1">{children}</div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// Loading Skeleton
// ---------------------------------------------------------------------------

function RecipeBuilderSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Skeleton className="h-8 w-8" />
        <Skeleton className="h-8 w-64" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Skeleton className="h-40 rounded-lg" />
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-16 rounded-lg" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-14 rounded-lg" />
          <Skeleton className="h-12 rounded-lg" />
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-12 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface RecipeBuilderProps {
  recipeId: string;
  preferredVolumeUnit?: string;
}

export function RecipeBuilder({
  recipeId,
}: RecipeBuilderProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const supabase = createClient();

  // Dialog state
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Fetch recipe data
  const {
    data: serverRecipe,
    isLoading,
    error,
  } = useQuery({
    queryKey: recipeKeys.detail(recipeId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipes")
        .select("*")
        .eq("id", recipeId)
        .single();
      if (error) throw error;
      return data as RecipeRow;
    },
  });

  // Local form state — initialized from server, updated optimistically
  const [localRecipe, setLocalRecipe] = useState<RecipeRow | null>(null);

  // Sync server data into local state (only on first load or if local is null)
  if (serverRecipe && !localRecipe) {
    setLocalRecipe(serverRecipe);
  }

  // Auto-save hook
  const { updateFields, status: saveStatus } = useRecipeAutoSave({
    recipeId,
  });

  // Field change handler — update local state immediately, debounce save
  const onFieldChange = useCallback(
    (fields: Partial<RecipeRow>) => {
      setLocalRecipe((prev) => (prev ? { ...prev, ...fields } : prev));
      updateFields(fields);
    },
    [updateFields]
  );

  // Junction tables for ingredient editors
  const grainBill = useJunctionTable<GrainBillItem>({
    table: "recipe_malts",
    recipeId,
    select: "*, malt:malts(id, name, maltster, type, color_lovibond, potential_ppg)",
  });

  const hopSchedule = useJunctionTable<HopScheduleItem>({
    table: "recipe_hops",
    recipeId,
    select: "*, hop:hops(id, name, origin, type, alpha_acid_typical, flavor_profile)",
  });

  const yeastItems = useJunctionTable<YeastItem>({
    table: "recipe_yeasts",
    recipeId,
    select: "*, yeast:yeasts(id, name, manufacturer, product_code, type, form, attenuation_typical, temp_min_f, temp_max_f, flocculation)",
  });

  // Clone / Delete handlers
  const handleCloneSuccess = (newRecipeId: string) => {
    router.push(`/production/recipes/${newRecipeId}`);
  };

  const handleDeleteSuccess = () => {
    queryClient.invalidateQueries({ queryKey: entityKeys.all("recipes") });
    queryClient.invalidateQueries({
      queryKey: entityKeys.all("recipes_with_estimates"),
    });
    router.push("/production/recipes");
  };

  // Mash schedule handlers
  const mashSchedule = (localRecipe?.mash_schedule as MashStep[] | null) ?? [];
  const handleMashChange = useCallback(
    (steps: MashStep[]) => {
      onFieldChange({ mash_schedule: steps as unknown as Database["public"]["Tables"]["recipes"]["Update"]["mash_schedule"] });
    },
    [onFieldChange]
  );

  // Fermentation schedule handlers
  const fermSchedule =
    (localRecipe?.fermentation_schedule as FermentationStage[] | null) ?? [];
  const handleFermChange = useCallback(
    (stages: FermentationStage[]) => {
      // Auto-calculate fermentation_days from schedule
      const totalDays = stages.reduce(
        (sum, s) => sum + (s.duration_days || 0),
        0
      );
      onFieldChange({
        fermentation_schedule: stages as unknown as Database["public"]["Tables"]["recipes"]["Update"]["fermentation_schedule"],
        fermentation_days: totalDays,
      });
    },
    [onFieldChange]
  );

  // Summary strings for collapsed sections
  const recipe = localRecipe;

  const grainBillSummary = grainBill.items.length
    ? `${grainBill.items.length} malt${grainBill.items.length !== 1 ? "s" : ""} · ${grainBill.items.reduce((s, i) => s + (i.weight_lbs || 0), 0).toLocaleString()} lbs`
    : "No malts added";

  const hopSummary = hopSchedule.items.length
    ? `${hopSchedule.items.length} hop${hopSchedule.items.length !== 1 ? "s" : ""}`
    : "No hops added";

  const yeastSummary = yeastItems.items.length
    ? yeastItems.items
        .map((y) => y.yeast?.name || "Unknown")
        .join(", ")
    : "No yeast selected";

  const mashSummary = mashSchedule.length
    ? `${mashSchedule.length} step${mashSchedule.length !== 1 ? "s" : ""} · ${mashSchedule.reduce((s, m) => s + (m.duration_min || 0), 0)} min`
    : "No mash steps";

  const fermSummary = fermSchedule.length
    ? `${fermSchedule.length} stage${fermSchedule.length !== 1 ? "s" : ""} · ${fermSchedule.reduce((s, f) => s + (f.duration_days || 0), 0)} days`
    : "No fermentation stages";

  const processSummary = recipe
    ? [
        recipe.boil_time_min ? `${recipe.boil_time_min} min boil` : null,
        recipe.whirlpool_time_min
          ? `${recipe.whirlpool_time_min} min WP`
          : null,
        recipe.target_ko_temp_f ? `KO ${recipe.target_ko_temp_f}°F` : null,
      ]
        .filter(Boolean)
        .join(" · ") || "No process parameters"
    : "";

  const noteCount = recipe
    ? [recipe.brew_day_notes, recipe.tasting_notes, recipe.development_notes].filter(
        Boolean
      ).length
    : 0;
  const notesSummary = noteCount ? `${noteCount} note${noteCount !== 1 ? "s" : ""}` : "No notes";

  if (isLoading) return <RecipeBuilderSkeleton />;
  if (error || !recipe) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-muted-foreground">
          {error ? "Failed to load recipe" : "Recipe not found"}
        </p>
        <Button variant="outline" onClick={() => router.push("/production/recipes")}>
          Back to recipes
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="container mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push("/production/recipes")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-lg font-semibold">{recipe.name}</h1>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {recipe.volume_bbl ? `${recipe.volume_bbl} BBL` : ""}
                  {recipe.boil_time_min ? ` · ${recipe.boil_time_min} min boil` : ""}
                </span>
                <SaveIndicator status={saveStatus} />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {recipe.status && (
              <Badge variant="outline" className="capitalize">
                {recipe.status}
              </Badge>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setCloneDialogOpen(true)}>
                  <Copy className="h-4 w-4 mr-2" />
                  Clone Recipe
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Recipe
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Grid Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Panel */}
          <div className="lg:col-span-2 space-y-4">
            {/* Recipe Basics — always open */}
            <div className="rounded-lg border bg-card px-4 py-4">
              <RecipeBuilderBasics recipe={recipe} onFieldChange={onFieldChange} />
            </div>

            {/* Grain Bill */}
            <BuilderSection title="Grain Bill" summary={grainBillSummary}>
              <GrainBillEditor
                items={grainBill.items}
                onChange={(items) => {
                  // Sync changes back: determine diffs and apply
                  syncJunctionChanges(grainBill, items);
                }}
                recipeId={recipeId}
              />
            </BuilderSection>

            {/* Hops */}
            <BuilderSection title="Hops" summary={hopSummary}>
              <HopScheduleEditor
                items={hopSchedule.items}
                onChange={(items) => {
                  syncJunctionChanges(hopSchedule, items);
                }}
                batchSizeGal={
                  recipe.batch_size_bbl
                    ? Number(recipe.batch_size_bbl) * 31
                    : undefined
                }
              />
            </BuilderSection>

            {/* Yeast */}
            <BuilderSection title="Yeast" summary={yeastSummary}>
              <YeastSelector
                items={yeastItems.items}
                onChange={(items) => {
                  syncJunctionChanges(yeastItems, items);
                }}
              />
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div className="space-y-1.5">
                  <Label htmlFor="target_attenuation">Target Attenuation %</Label>
                  <Input
                    id="target_attenuation"
                    type="number"
                    value={recipe.target_attenuation ?? ""}
                    onChange={(e) =>
                      onFieldChange({
                        target_attenuation: e.target.value
                          ? Number(e.target.value)
                          : null,
                      })
                    }
                    placeholder="e.g., 75"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="target_pitching_rate">
                    Pitching Rate (M cells/mL/°P)
                  </Label>
                  <Input
                    id="target_pitching_rate"
                    type="number"
                    value={recipe.target_pitching_rate ?? ""}
                    onChange={(e) =>
                      onFieldChange({
                        target_pitching_rate: e.target.value
                          ? Number(e.target.value)
                          : null,
                      })
                    }
                    placeholder="e.g., 0.75"
                  />
                </div>
              </div>
            </BuilderSection>

            {/* Mash */}
            <BuilderSection title="Mash" summary={mashSummary}>
              <MashScheduleEditor
                steps={mashSchedule}
                onChange={handleMashChange}
              />
              <div className="grid grid-cols-4 gap-3 mt-3">
                <div className="space-y-1.5">
                  <Label htmlFor="mash_temp_f">Mash Temp (°F)</Label>
                  <Input
                    id="mash_temp_f"
                    type="number"
                    value={recipe.mash_temp_f ?? ""}
                    onChange={(e) =>
                      onFieldChange({
                        mash_temp_f: e.target.value
                          ? Number(e.target.value)
                          : null,
                      })
                    }
                    placeholder="152"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="target_mash_ph">Target pH</Label>
                  <Input
                    id="target_mash_ph"
                    type="number"
                    value={recipe.target_mash_ph ?? ""}
                    onChange={(e) =>
                      onFieldChange({
                        target_mash_ph: e.target.value
                          ? Number(e.target.value)
                          : null,
                      })
                    }
                    placeholder="5.4"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mash_efficiency">Efficiency %</Label>
                  <Input
                    id="mash_efficiency"
                    type="number"
                    value={recipe.mash_efficiency ?? ""}
                    onChange={(e) =>
                      onFieldChange({
                        mash_efficiency: e.target.value
                          ? Number(e.target.value)
                          : null,
                      })
                    }
                    placeholder="75"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="water_to_grain_ratio">Water:Grain</Label>
                  <Input
                    id="water_to_grain_ratio"
                    type="number"
                    value={recipe.water_to_grain_ratio ?? ""}
                    onChange={(e) =>
                      onFieldChange({
                        water_to_grain_ratio: e.target.value
                          ? Number(e.target.value)
                          : null,
                      })
                    }
                    placeholder="1.5"
                  />
                </div>
              </div>
            </BuilderSection>

            {/* Boil, Whirlpool & Knock-Out */}
            <BuilderSection
              title="Boil, Whirlpool & Knock-Out"
              summary={processSummary}
            >
              <RecipeBuilderProcess recipe={recipe} onFieldChange={onFieldChange} />
            </BuilderSection>

            {/* Fermentation */}
            <BuilderSection title="Fermentation" summary={fermSummary}>
              <FermentationScheduleEditor
                stages={fermSchedule}
                onChange={handleFermChange}
              />
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div className="space-y-1.5">
                  <Label htmlFor="fermentation_days">
                    Fermentation Days
                  </Label>
                  <Input
                    id="fermentation_days"
                    type="number"
                    value={recipe.fermentation_days ?? ""}
                    disabled
                    className="bg-muted"
                  />
                  <p className="text-xs text-muted-foreground">
                    Auto-calculated from schedule
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="conditioning_days">
                    Conditioning Days
                  </Label>
                  <Input
                    id="conditioning_days"
                    type="number"
                    value={recipe.conditioning_days ?? ""}
                    onChange={(e) =>
                      onFieldChange({
                        conditioning_days: e.target.value
                          ? Number(e.target.value)
                          : null,
                      })
                    }
                    placeholder="7"
                  />
                </div>
              </div>
            </BuilderSection>

            {/* Notes */}
            <BuilderSection
              title="Notes"
              summary={notesSummary}
              defaultOpen={false}
            >
              <RecipeBuilderNotes recipe={recipe} onFieldChange={onFieldChange} />
            </BuilderSection>
          </div>

          {/* Right Panel — Sticky Sidebar */}
          <div className="lg:col-span-1">
            <div className="sticky top-20 space-y-4 max-h-[calc(100vh-5rem)] overflow-y-auto">
              <RecipeBuilderSidebar recipeId={recipeId} recipe={recipe} />
            </div>
          </div>
        </div>
      </div>

      {/* Dialogs */}
      <RecipeCloneDialog
        recipeId={recipeId}
        recipeName={recipe.name}
        isTemplate={recipe.is_template || false}
        open={cloneDialogOpen}
        onOpenChange={setCloneDialogOpen}
        onSuccess={handleCloneSuccess}
      />
      <RecipeDeleteDialog
        recipeId={recipeId}
        recipeName={recipe.name}
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onSuccess={handleDeleteSuccess}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Junction Table Sync Helper
// ---------------------------------------------------------------------------
// The existing editors use an onChange(items[]) pattern where the full array
// is returned. We need to diff against the server state and apply individual
// mutations. For now, we use a simple full-replace strategy: delete removed,
// update changed, insert new.

function syncJunctionChanges<T extends { id?: string }>(
  junction: ReturnType<typeof useJunctionTable<T>>,
  newItems: T[]
) {
  const oldItems = junction.items;
  const oldIds = new Set(oldItems.map((i) => i.id).filter(Boolean));
  const newIds = new Set(newItems.map((i) => i.id).filter(Boolean));

  // Items to remove (in old but not in new)
  for (const item of oldItems) {
    if (item.id && !newIds.has(item.id)) {
      junction.remove(item.id);
    }
  }

  // Items to add (no id) or update (id exists)
  for (const item of newItems) {
    if (!item.id) {
      // New item — strip the id field and add
      const { id: _omitted, ...rest } = item;
      void _omitted;
      junction.add(rest as Omit<T, "id">);
    } else if (oldIds.has(item.id)) {
      // Existing item — update with all fields
      const { id, ...fields } = item;
      junction.update({ id: id!, fields: fields as Partial<T> });
    }
  }
}
