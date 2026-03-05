"use client";

/**
 * CreateBatchFromShortfall - Create a planned batch to address a production shortfall
 *
 * Pre-fills batch data based on the shortfall:
 * - Recipe selection (filtered by brand)
 * - Planned start date (from recommended brew start)
 * - Volume estimation based on shortfall quantity
 */

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/form-resolver";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { recipeKeys, batchKeys } from "@/lib/query-keys";
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
import { Loader2, FlaskConical, Calendar, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import type { ProductionShortfall } from "@/types/planning";

// =============================================================================
// Types
// =============================================================================

const createBatchSchema = z.object({
  batch_number: z.string().min(1, "Batch number is required"),
  name: z.string().min(1, "Name is required"),
  recipe_id: z.string().uuid("Please select a recipe"),
  planned_start_date: z.string().min(1, "Planned start date is required"),
  volume_bbl: z.coerce.number().positive("Volume must be positive"),
  notes: z.string().optional(),
});

type CreateBatchFormValues = z.infer<typeof createBatchSchema>;

interface CreateBatchFromShortfallProps {
  shortfall: ProductionShortfall;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function CreateBatchFromShortfall({
  shortfall,
  open,
  onOpenChange,
  onSuccess,
}: CreateBatchFromShortfallProps) {
  const supabase = createClient();

  // Fetch recipes for this brand
  const { data: recipes, isLoading: recipesLoading } = useQuery({
    queryKey: recipeKeys.byBrand(shortfall.brand_id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipes")
        .select("id, name, batch_size_bbl, fermentation_days, conditioning_days")
        .eq("brand_id", shortfall.brand_id)
        .eq("is_active", true)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: open && !!shortfall.brand_id,
  });

  // Fetch next batch number
  const { data: nextBatchNumber } = useQuery({
    queryKey: batchKeys.nextNumber(),
    queryFn: async () => {
      const year = new Date().getFullYear();
      const { data, error } = await supabase
        .from("batches")
        .select("batch_number")
        .ilike("batch_number", `${year}-%`)
        .order("batch_number", { ascending: false })
        .limit(1);

      if (error) throw error;

      if (data && data.length > 0) {
        const lastNumber = data[0].batch_number;
        const match = lastNumber.match(/\d+-(\d+)/);
        if (match) {
          const next = parseInt(match[1]) + 1;
          return `${year}-${next.toString().padStart(3, "0")}`;
        }
      }
      return `${year}-001`;
    },
    enabled: open,
  });

  // Form setup
  const form = useForm<CreateBatchFormValues>({
    resolver: zodResolver(createBatchSchema),
    defaultValues: {
      batch_number: "",
      name: "",
      recipe_id: shortfall.recipe_id || "",
      planned_start_date: shortfall.recommended_brew_start,
      volume_bbl: 10, // Default, will update based on recipe
      notes: `Created from production planning to address shortfall of ${shortfall.shortfall_quantity} cases for week of ${shortfall.demand_week}.`,
    },
  });

  // Update form when data loads
  useEffect(() => {
    if (nextBatchNumber) {
      form.setValue("batch_number", nextBatchNumber);
    }
  }, [nextBatchNumber, form]);

  useEffect(() => {
    if (shortfall.recipe_id) {
      form.setValue("recipe_id", shortfall.recipe_id);
    }
  }, [shortfall.recipe_id, form]);

  // Update name and volume when recipe changes
  const selectedRecipeId = form.watch("recipe_id");
  useEffect(() => {
    const recipe = recipes?.find((r) => r.id === selectedRecipeId);
    if (recipe) {
      form.setValue("name", `${shortfall.brand_name} - ${recipe.name}`);
      if (recipe.batch_size_bbl) {
        form.setValue("volume_bbl", recipe.batch_size_bbl);
      }
    }
  }, [selectedRecipeId, recipes, shortfall.brand_name, form]);

  // Create batch mutation
  const createMutation = useMutation({
    mutationFn: async (values: CreateBatchFormValues) => {
      const { data, error } = await supabase
        .from("batches")
        .insert({
          batch_number: values.batch_number,
          name: values.name,
          recipe_id: values.recipe_id,
          planned_start_date: values.planned_start_date,
          volume_bbl: values.volume_bbl,
          status: "planned",
          notes: values.notes,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Batch ${data.batch_number} created`);
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error) => {
      console.error("Create batch error:", error);
      const message = error instanceof Error ? error.message : "Failed to create batch";
      toast.error(message);
    },
  });

  const handleSubmit = form.handleSubmit((values) => {
    createMutation.mutate(values);
  });

  const selectedRecipe = recipes?.find((r) => r.id === selectedRecipeId);
  const isPastStart = new Date(shortfall.recommended_brew_start) < new Date();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5" />
            Create Planned Batch
          </DialogTitle>
          <DialogDescription>
            Create a batch to address the shortfall for{" "}
            <span className="font-medium">{shortfall.brand_name}</span> ({shortfall.selling_format_name}).
          </DialogDescription>
        </DialogHeader>

        {/* Shortfall Summary */}
        <div className="rounded-lg border p-3 bg-muted/50">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-muted-foreground">Shortfall:</span>{" "}
              <span className="font-medium">{shortfall.shortfall_quantity.toLocaleString()} cases</span>
            </div>
            <div>
              <span className="text-muted-foreground">Demand Week:</span>{" "}
              <span className="font-medium">
                {new Date(shortfall.demand_week).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </div>
            <div className="col-span-2 flex items-center gap-1">
              {isPastStart && <AlertTriangle className="h-4 w-4 text-destructive" />}
              <span className="text-muted-foreground">Recommended Start:</span>{" "}
              <span className={`font-medium ${isPastStart ? "text-destructive" : ""}`}>
                {new Date(shortfall.recommended_brew_start).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
              {isPastStart && <span className="text-xs text-destructive">(past due)</span>}
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="batch_number">Batch Number</Label>
              <Input
                id="batch_number"
                {...form.register("batch_number")}
                placeholder="e.g., 2025-001"
              />
              {form.formState.errors.batch_number && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.batch_number.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="planned_start_date">Planned Start</Label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="planned_start_date"
                  type="date"
                  className="pl-9"
                  {...form.register("planned_start_date")}
                />
              </div>
              {form.formState.errors.planned_start_date && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.planned_start_date.message}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="recipe_id">Recipe</Label>
            <Select
              value={form.watch("recipe_id")}
              onValueChange={(v) => form.setValue("recipe_id", v)}
              disabled={recipesLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder={recipesLoading ? "Loading..." : "Select recipe..."} />
              </SelectTrigger>
              <SelectContent>
                {recipes?.length === 0 ? (
                  <div className="p-2 text-sm text-muted-foreground text-center">
                    No recipes for this brand
                  </div>
                ) : (
                  recipes?.map((recipe) => (
                    <SelectItem key={recipe.id} value={recipe.id}>
                      <span className="font-medium">{recipe.name}</span>
                      {recipe.batch_size_bbl && (
                        <span className="text-muted-foreground ml-2">
                          ({recipe.batch_size_bbl} BBL)
                        </span>
                      )}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {form.formState.errors.recipe_id && (
              <p className="text-sm text-destructive">
                {form.formState.errors.recipe_id.message}
              </p>
            )}
            {selectedRecipe && (
              <p className="text-xs text-muted-foreground">
                Lead time: {selectedRecipe.fermentation_days || 14} fermentation +{" "}
                {selectedRecipe.conditioning_days || 7} conditioning days
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">Batch Name</Label>
            <Input
              id="name"
              {...form.register("name")}
              placeholder="e.g., Hazy IPA #5"
            />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive">
                {form.formState.errors.name.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="volume_bbl">Volume (BBL)</Label>
            <Input
              id="volume_bbl"
              type="number"
              step="0.1"
              {...form.register("volume_bbl")}
              placeholder="e.g., 10"
            />
            {form.formState.errors.volume_bbl && (
              <p className="text-sm text-destructive">
                {form.formState.errors.volume_bbl.message}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending || !recipes?.length}
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <FlaskConical className="h-4 w-4 mr-2" />
                  Create Batch
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
