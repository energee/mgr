"use client";

/**
 * StartBrewDayDialog - Multi-step dialog for starting a brew day
 *
 * Creates a brew log + N batches in one guided flow:
 * Step 0 (optional): Select recipe (when recipeId not provided)
 * Step 1: Confirm recipe & date
 * Step 2: Configure batch splits (from recipe variants or manual)
 * Step 3: Review & create all records
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  recipeVariantKeys,
  entityKeys,
  recipeKeys,
  batchKeys,
  brewLogKeys,
  vesselKeys,
  userKeys,
} from "@/lib/query-keys";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ChevronRight,
  ChevronLeft,
  Plus,
  Trash2,
  Play,
  Beer,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { UnitDisplay } from "@/components/ui/unit-input";

// =============================================================================
// Types
// =============================================================================

interface StartBrewDayDialogProps {
  recipeId?: string;
  recipeName?: string;
  existingBatchId?: string;
  existingBatchVolume?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (brewLogId: string) => void;
}

interface SplitConfig {
  name: string;
  batchNumber: string;
  volumeBbl: number | null;
  vesselId: string | null;
  recipeVariantId: string | null;
}

interface RecipeSummary {
  id: string;
  name: string;
  batch_size_bbl: number | null;
  est_og: number | null;
  est_ibu: number | null;
  est_abv: number | null;
  style_name: string | null;
}

interface RecipeVariant {
  id: string;
  name: string;
  planned_volume_bbl: number | null;
  description: string | null;
}

interface AvailableVessel {
  id: string;
  name: string;
  vessel_type: string | null;
  capacity_bbl: number | null;
  current_batch_id: string | null;
}

// =============================================================================
// Helpers
// =============================================================================

function generateBrewNumber(): string {
  const now = new Date();
  const year = now.getFullYear();
  const dayOfYear = Math.floor(
    (now.getTime() - new Date(year, 0, 0).getTime()) / 86400000
  );
  return `BRW-${year}-${String(dayOfYear).padStart(3, "0")}`;
}

function generateBatchNumber(index: number): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `B-${year}${month}${day}-${String(index + 1).padStart(2, "0")}`;
}

// =============================================================================
// Component
// =============================================================================

export function StartBrewDayDialog({
  recipeId,
  recipeName,
  existingBatchId,
  existingBatchVolume,
  open,
  onOpenChange,
  onSuccess,
}: StartBrewDayDialogProps) {
  const supabase = createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const queryClient = useQueryClient();

  // ---------------------------------------------------------------------------
  // Recipe Selector State (when recipeId not provided)
  // ---------------------------------------------------------------------------
  const [selectedRecipeId, setSelectedRecipeId] = useState(recipeId ?? "");
  const [selectedRecipeName, setSelectedRecipeName] = useState(
    recipeName ?? ""
  );

  const effectiveRecipeId = recipeId ?? selectedRecipeId;
  const effectiveRecipeName = recipeName ?? selectedRecipeName;
  const hasRecipeSelector = !recipeId;
  const hasExistingBatch = !!existingBatchId;
  const totalSteps = (hasRecipeSelector ? 4 : 3) - (hasExistingBatch ? 1 : 0);
  const initialStep = hasRecipeSelector ? 0 : 1;

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const [step, setStep] = useState(initialStep);
  const [brewDate, setBrewDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [brewNumber, setBrewNumber] = useState("");
  const [splits, setSplits] = useState<SplitConfig[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ---------------------------------------------------------------------------
  // Data Fetching
  // ---------------------------------------------------------------------------

  // Fetch current user for brewer default
  const { data: currentUser } = useQuery({
    queryKey: userKeys.current(),
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return user;
    },
    enabled: open,
  });

  // Fetch available recipes (for recipe selector mode)
  const { data: recipes = [] } = useQuery({
    queryKey: recipeKeys.list({ status: "complete" }),
    queryFn: async () => {
      const { data, error } = await db
        .from("recipes")
        .select("id, name, style_name")
        .eq("status", "complete")
        .order("name");
      if (error) throw error;
      return data as { id: string; name: string; style_name: string | null }[];
    },
    enabled: open && hasRecipeSelector,
  });

  // Fetch recipe summary from recipes_with_estimates
  const { data: recipeSummary, isLoading: recipeLoading } = useQuery({
    queryKey: recipeKeys.estimates(effectiveRecipeId),
    queryFn: async () => {
      const { data, error } = await db
        .from("recipes_with_estimates")
        .select(
          "id, name, batch_size_bbl, est_og, est_ibu, est_abv, style_name"
        )
        .eq("id", effectiveRecipeId)
        .single();
      if (error) throw error;
      return data as RecipeSummary;
    },
    enabled: open && !!effectiveRecipeId,
  });

  // Fetch recipe variants
  const { data: variants = [], isLoading: variantsLoading } = useQuery({
    queryKey: recipeVariantKeys.byRecipe(effectiveRecipeId),
    queryFn: async () => {
      const { data, error } = await db
        .from("recipe_variants")
        .select("id, name, planned_volume_bbl, description")
        .eq("recipe_id", effectiveRecipeId)
        .order("position");
      if (error) throw error;
      return data as RecipeVariant[];
    },
    enabled: open && !!effectiveRecipeId,
  });

  // Fetch available vessels (no current batch)
  const { data: availableVessels = [] } = useQuery({
    queryKey: vesselKeys.available(),
    queryFn: async () => {
      const { data, error } = await db
        .from("vessels_with_batch")
        .select("id, name, vessel_type, capacity_bbl, current_batch_id")
        .is("current_batch_id", null)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as AvailableVessel[];
    },
    enabled: open,
  });

  // ---------------------------------------------------------------------------
  // Initialize splits when variants load
  // ---------------------------------------------------------------------------
  const initializeSplits = useCallback(() => {
    if (variants.length > 0) {
      setSplits(
        variants.map((v, i) => ({
          name: v.name,
          batchNumber: generateBatchNumber(i),
          volumeBbl: v.planned_volume_bbl,
          vesselId: null,
          recipeVariantId: v.id,
        }))
      );
    } else {
      setSplits([
        {
          name: effectiveRecipeName,
          batchNumber: generateBatchNumber(0),
          volumeBbl: recipeSummary?.batch_size_bbl ?? null,
          vesselId: null,
          recipeVariantId: null,
        },
      ]);
    }
  }, [variants, effectiveRecipeName, recipeSummary?.batch_size_bbl]);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setStep(initialStep);
      setBrewDate(new Date().toISOString().split("T")[0]);
      setBrewNumber(generateBrewNumber());
      setSplits([]);
      if (!recipeId) {
        setSelectedRecipeId("");
        setSelectedRecipeName("");
      }
    }
  }, [open, initialStep, recipeId]);

  // Initialize splits when data is ready and we move to step 2
  useEffect(() => {
    if (
      open &&
      splits.length === 0 &&
      !variantsLoading &&
      !recipeLoading &&
      !!effectiveRecipeId
    ) {
      initializeSplits();
    }
  }, [
    open,
    splits.length,
    variantsLoading,
    recipeLoading,
    effectiveRecipeId,
    initializeSplits,
  ]);

  // ---------------------------------------------------------------------------
  // Split Management
  // ---------------------------------------------------------------------------

  const updateSplit = (index: number, updates: Partial<SplitConfig>) => {
    setSplits((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...updates } : s))
    );
  };

  const addSplit = () => {
    setSplits((prev) => [
      ...prev,
      {
        name: `${effectiveRecipeName} - Split ${prev.length + 1}`,
        batchNumber: generateBatchNumber(prev.length),
        volumeBbl: null,
        vesselId: null,
        recipeVariantId: null,
      },
    ]);
  };

  const removeSplit = (index: number) => {
    if (splits.length <= 1) return;
    setSplits((prev) => prev.filter((_, i) => i !== index));
  };

  // ---------------------------------------------------------------------------
  // Computed
  // ---------------------------------------------------------------------------

  const totalVolume = useMemo(
    () => splits.reduce((sum, s) => sum + (s.volumeBbl ?? 0), 0),
    [splits]
  );

  const isStep0Valid = !!selectedRecipeId;

  const isStep1Valid = brewNumber.trim().length > 0 && brewDate.length > 0;

  const isStep2Valid =
    splits.length > 0 &&
    splits.every(
      (s) =>
        s.name.trim().length > 0 &&
        s.batchNumber.trim().length > 0 &&
        s.volumeBbl != null &&
        s.volumeBbl > 0
    );

  // ---------------------------------------------------------------------------
  // Submission
  // ---------------------------------------------------------------------------

  const handleSubmit = async () => {
    if (!hasExistingBatch && !isStep2Valid) return;
    setIsSubmitting(true);

    try {
      // 1. Insert brew log
      const { data: brewLog, error: brewLogError } = await db
        .from("brew_logs")
        .insert({
          brew_number: brewNumber.trim(),
          brew_date: brewDate,
          recipe_id: effectiveRecipeId,
          brewer_id: currentUser?.id ?? null,
          status: "draft",
        })
        .select("id")
        .single();

      if (brewLogError) throw brewLogError;
      const brewLogId = brewLog.id as string;

      if (hasExistingBatch) {
        // Link existing batch to new brew log (no new batch creation)
        const { error: junctionError } = await db
          .from("brew_log_batches")
          .insert({
            brew_log_id: brewLogId,
            batch_id: existingBatchId,
            volume_bbl: existingBatchVolume ?? 0,
          });

        if (junctionError) throw junctionError;
      } else {
        // 2. Insert batches
        const batchInserts = splits.map((s) => ({
          name: s.name.trim(),
          batch_number: s.batchNumber.trim(),
          recipe_id: effectiveRecipeId,
          recipe_variant_id: s.recipeVariantId || null,
          status: "planned",
          volume_bbl: s.volumeBbl,
          planned_start_date: brewDate,
        }));

        const { data: batches, error: batchesError } = await db
          .from("batches")
          .insert(batchInserts)
          .select("id");

        if (batchesError) throw batchesError;

        // 3. Insert brew_log_batches junction records
        const junctionInserts = (batches as { id: string }[]).map(
          (batch, index) => ({
            brew_log_id: brewLogId,
            batch_id: batch.id,
            volume_bbl: splits[index].volumeBbl ?? 0,
          })
        );

        const { error: junctionError } = await db
          .from("brew_log_batches")
          .insert(junctionInserts);

        if (junctionError) throw junctionError;

        // 4. Insert vessel_transfers for any assigned vessels
        const vesselTransfers = splits
          .map((s, index) => {
            if (!s.vesselId) return null;
            const batch = (batches as { id: string }[])[index];
            return {
              batch_id: batch.id,
              to_vessel_id: s.vesselId,
              volume_bbl: s.volumeBbl ?? 0,
              transferred_at: `${brewDate}T00:00:00`,
              notes: `Initial vessel assignment from brew day ${brewNumber}`,
            };
          })
          .filter(Boolean);

        if (vesselTransfers.length > 0) {
          const { error: transferError } = await db
            .from("vessel_transfers")
            .insert(vesselTransfers);

          if (transferError) throw transferError;
        }
      }

      // Invalidate caches
      queryClient.invalidateQueries({ queryKey: brewLogKeys.all() });
      queryClient.invalidateQueries({ queryKey: batchKeys.all() });
      queryClient.invalidateQueries({ queryKey: entityKeys.all("brew_logs") });
      queryClient.invalidateQueries({ queryKey: entityKeys.all("batches") });
      queryClient.invalidateQueries({ queryKey: vesselKeys.all() });

      toast.success(
        hasExistingBatch
          ? "Brew day started and linked to existing batch"
          : `Brew day started with ${splits.length} batch${splits.length > 1 ? "es" : ""}`
      );

      handleClose();
      onSuccess(brewLogId);
    } catch (error) {
      console.error("Start brew day error:", error);
      const message =
        error instanceof Error ? error.message : "Failed to start brew day";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (isSubmitting) return;
    setStep(initialStep);
    setSplits([]);
    setBrewNumber("");
    setBrewDate(new Date().toISOString().split("T")[0]);
    if (!recipeId) {
      setSelectedRecipeId("");
      setSelectedRecipeName("");
    }
    onOpenChange(false);
  };

  // ---------------------------------------------------------------------------
  // Render Helpers
  // ---------------------------------------------------------------------------

  const renderStep0 = () => (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Select Recipe</Label>
        <Select
          value={selectedRecipeId}
          onValueChange={(val) => {
            setSelectedRecipeId(val);
            const recipe = recipes.find((r) => r.id === val);
            setSelectedRecipeName(recipe?.name ?? "");
            // Reset splits when recipe changes so they re-initialize
            setSplits([]);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Choose a recipe..." />
          </SelectTrigger>
          <SelectContent>
            {recipes.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.name}
                {r.style_name ? ` (${r.style_name})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );

  const renderStep1 = () => (
    <div className="space-y-4">
      {/* Recipe name (read-only) */}
      <div className="space-y-2">
        <Label>Recipe</Label>
        <div className="flex items-center gap-2 p-3 rounded-md border bg-muted/30">
          <Beer className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{effectiveRecipeName}</span>
        </div>
      </div>

      {/* Recipe summary */}
      {recipeLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading recipe details...
        </div>
      ) : recipeSummary ? (
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 rounded-md border text-center">
            <div className="text-xs text-muted-foreground">Volume</div>
            <div className="font-medium">
              <UnitDisplay
                value={recipeSummary.batch_size_bbl}
                unitType="volume"
                decimals={1}
              />
            </div>
          </div>
          <div className="p-3 rounded-md border text-center">
            <div className="text-xs text-muted-foreground">Est. OG</div>
            <div className="font-medium">
              {recipeSummary.est_og?.toFixed(3) ?? "-"}
            </div>
          </div>
          <div className="p-3 rounded-md border text-center">
            <div className="text-xs text-muted-foreground">Est. IBU</div>
            <div className="font-medium">
              {recipeSummary.est_ibu?.toFixed(0) ?? "-"}
            </div>
          </div>
        </div>
      ) : null}

      <Separator />

      {/* Brew date */}
      <div className="space-y-2">
        <Label htmlFor="brew-date">Brew Date</Label>
        <Input
          id="brew-date"
          type="date"
          value={brewDate}
          onChange={(e) => setBrewDate(e.target.value)}
        />
      </div>

      {/* Brew number */}
      <div className="space-y-2">
        <Label htmlFor="brew-number">Brew Number</Label>
        <Input
          id="brew-number"
          type="text"
          value={brewNumber}
          onChange={(e) => setBrewNumber(e.target.value)}
          placeholder="e.g., BRW-2024-001"
        />
      </div>
    </div>
  );

  const renderStep2 = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            {variants.length > 0
              ? `${variants.length} variant${variants.length > 1 ? "s" : ""} found for this recipe`
              : "Configure batch splits for this brew"}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addSplit}>
          <Plus className="h-4 w-4 mr-1" />
          Add Split
        </Button>
      </div>

      <div className="space-y-3 max-h-[45vh] overflow-y-auto pr-1">
        {splits.map((split, index) => (
          <Card key={index}>
            <CardContent className="pt-4 pb-4 space-y-3">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="text-xs">
                  Batch {index + 1}
                </Badge>
                {splits.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeSplit(index)}
                    className="text-muted-foreground hover:text-destructive h-7 w-7 p-0"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Batch name */}
                <div className="space-y-1">
                  <Label className="text-xs">Batch Name</Label>
                  <Input
                    value={split.name}
                    onChange={(e) =>
                      updateSplit(index, { name: e.target.value })
                    }
                    placeholder="Batch name"
                    className="h-9"
                  />
                </div>

                {/* Batch number */}
                <div className="space-y-1">
                  <Label className="text-xs">Batch Number</Label>
                  <Input
                    value={split.batchNumber}
                    onChange={(e) =>
                      updateSplit(index, { batchNumber: e.target.value })
                    }
                    placeholder="e.g., B-20240115-01"
                    className="h-9"
                  />
                </div>

                {/* Volume */}
                <div className="space-y-1">
                  <Label className="text-xs">Volume (BBL)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={split.volumeBbl ?? ""}
                    onChange={(e) =>
                      updateSplit(index, {
                        volumeBbl: e.target.value
                          ? parseFloat(e.target.value)
                          : null,
                      })
                    }
                    placeholder="e.g., 10.0"
                    className="h-9"
                  />
                </div>

                {/* Vessel */}
                <div className="space-y-1">
                  <Label className="text-xs">Vessel (optional)</Label>
                  <Select
                    value={split.vesselId ?? "_none"}
                    onValueChange={(val) =>
                      updateSplit(index, {
                        vesselId: val === "_none" ? null : val,
                      })
                    }
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Select vessel..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">No vessel</SelectItem>
                      {availableVessels
                        .filter(
                          (v) =>
                            !splits.some(
                              (s, i) => i !== index && s.vesselId === v.id
                            )
                        )
                        .map((v) => (
                          <SelectItem key={v.id} value={v.id}>
                            {v.name}
                            {v.capacity_bbl && (
                              <> (<UnitDisplay value={v.capacity_bbl} unitType="volume" />)</>
                            )}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Volume total */}
      <div className="flex items-center justify-between p-3 rounded-md border bg-muted/30">
        <span className="text-sm text-muted-foreground">Total Volume</span>
        <span className="font-medium">
          <UnitDisplay value={totalVolume} unitType="volume" decimals={1} />
        </span>
      </div>
    </div>
  );

  const renderStep3 = () => (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Review the following records that will be created.
      </p>

      {/* Brew Log summary */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium">Brew Log</h4>
        <div className="p-3 rounded-md border space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Brew Number</span>
            <span className="font-medium">{brewNumber}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Brew Date</span>
            <span className="font-medium">
              {new Date(brewDate + "T00:00:00").toLocaleDateString()}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Recipe</span>
            <span className="font-medium">{effectiveRecipeName}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Status</span>
            <Badge variant="outline">Draft</Badge>
          </div>
        </div>
      </div>

      <Separator />

      {/* Batches summary */}
      {hasExistingBatch ? (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Existing Batch</h4>
          <div className="p-3 rounded-md border space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Volume</span>
              <span>
                <UnitDisplay
                  value={existingBatchVolume ?? null}
                  unitType="volume"
                  decimals={1}
                />
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              This brew log will be linked to the existing batch.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <h4 className="text-sm font-medium">
              {splits.length} Batch{splits.length > 1 ? "es" : ""}
            </h4>
            <div className="space-y-2 max-h-[30vh] overflow-y-auto pr-1">
              {splits.map((split, index) => {
                const vessel = split.vesselId
                  ? availableVessels.find((v) => v.id === split.vesselId)
                  : null;
                return (
                  <div key={index} className="p-3 rounded-md border space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{split.name}</span>
                      <Badge variant="outline" className="text-xs">
                        Planned
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Batch #</span>
                        <span>{split.batchNumber}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Volume</span>
                        <span>
                          <UnitDisplay
                            value={split.volumeBbl}
                            unitType="volume"
                            decimals={1}
                          />
                        </span>
                      </div>
                      {vessel && (
                        <div className="flex justify-between col-span-2">
                          <span className="text-muted-foreground">Vessel</span>
                          <span>{vessel.name}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Totals */}
          <div className="flex items-center justify-between p-3 rounded-md border bg-muted/30">
            <span className="text-sm text-muted-foreground">Total Volume</span>
            <span className="font-medium">
              <UnitDisplay value={totalVolume} unitType="volume" decimals={1} />
            </span>
          </div>
        </>
      )}
    </div>
  );

  // ---------------------------------------------------------------------------
  // Step Navigation Helpers
  // ---------------------------------------------------------------------------

  const stepTitles = useMemo(() => {
    const titles: string[] = [];
    if (hasRecipeSelector) titles.push("Select Recipe");
    titles.push("Confirm Recipe & Date");
    if (!hasExistingBatch) titles.push("Configure Splits");
    titles.push("Review & Create");
    return titles;
  }, [hasRecipeSelector, hasExistingBatch]);

  const stepDisplayIndex = useMemo(() => {
    let idx = hasRecipeSelector ? step : step - 1;
    if (hasExistingBatch && step >= 3) idx--;
    return idx;
  }, [hasRecipeSelector, hasExistingBatch, step]);

  const nextStep = () => {
    setStep((s) => {
      const next = s + 1;
      // Skip step 2 when linking existing batch
      if (hasExistingBatch && next === 2) return 3;
      return next;
    });
  };

  const prevStep = () => {
    setStep((s) => {
      const prev = s - 1;
      // Skip step 2 when going back from step 3
      if (hasExistingBatch && prev === 2) return 1;
      return prev;
    });
  };

  const isCurrentStepValid = () => {
    if (step === 0) return isStep0Valid;
    if (step === 1) return isStep1Valid;
    if (step === 2) return isStep2Valid;
    return true;
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="h-5 w-5" />
            Start Brew Day
          </DialogTitle>
          <DialogDescription>
            Step {stepDisplayIndex + 1} of {totalSteps}:{" "}
            {stepTitles[stepDisplayIndex]}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicators */}
        <div className="flex items-center gap-1 px-1">
          {Array.from({ length: totalSteps }, (_, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                i <= stepDisplayIndex ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </div>

        {/* Step content */}
        {hasRecipeSelector && step === 0 && renderStep0()}
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}

        <DialogFooter className="flex-row justify-between sm:justify-between">
          <div>
            {step > initialStep && (
              <Button
                type="button"
                variant="outline"
                onClick={prevStep}
                disabled={isSubmitting}
                className="min-h-[44px]"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isSubmitting}
              className="min-h-[44px]"
            >
              Cancel
            </Button>
            {step < 3 ? (
              <Button
                type="button"
                onClick={nextStep}
                disabled={!isCurrentStepValid()}
                className="min-h-[44px]"
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting || (!hasExistingBatch && !isStep2Valid)}
                className="min-h-[44px]"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Start Brew Day
                  </>
                )}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
