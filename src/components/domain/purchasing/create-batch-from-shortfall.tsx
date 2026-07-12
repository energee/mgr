"use client";

/**
 * CreateBatchFromShortfall - Create a planned batch to address a production shortfall
 *
 * Pre-fills batch data based on the shortfall:
 * - Recipe selection (filtered by brand)
 * - Planned start date (from recommended brew start)
 * - Volume estimation based on shortfall quantity
 *
 * Fields use the shared Form primitives (FormField/FormControl/FormMessage)
 * so validation errors are announced and associated with their inputs
 * (audit A11Y-3).
 */

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/form-resolver";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { recipeKeys } from "@/lib/query-keys";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { UnitDisplay } from "@/components/ui/unit-input";
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
import { scheduleDays } from "@/domain/batch-schedule";
import { log } from "@/lib/client-logger";
import { unwrap } from "@/lib/supabase/query-helpers";

// =============================================================================
// Types
// =============================================================================

const createBatchSchema = z.object({
  name: z.string().min(1, "Name is required"),
  recipe_id: z.string().uuid("Please select a recipe"),
  planned_start_date: z.string().min(1, "Planned start date is required"),
  volume_bbl: z.coerce.number().positive("Volume must be positive"),
  notes: z.string().optional(),
});

type CreateBatchFormValues = z.infer<typeof createBatchSchema>;

type CreateBatchFromShortfallProps = {
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
      return await unwrap(
        supabase
          .from("recipes")
          .select("id, name, batch_size_bbl, fermentation_days, conditioning_days")
          .eq("brand_id", shortfall.brand_id)
          .eq("is_active", true)
          .order("updated_at", { ascending: false })
      );
    },
    enabled: open && !!shortfall.brand_id,
  });

  // Form setup
  const form = useForm<CreateBatchFormValues>({
    resolver: zodResolver(createBatchSchema),
    defaultValues: {
      name: "",
      recipe_id: shortfall.recipe_id || "",
      planned_start_date: shortfall.recommended_brew_start,
      volume_bbl: 10, // Default, will update based on recipe
      notes: `Created from production planning to address shortfall of ${shortfall.shortfall_quantity} cases for week of ${shortfall.demand_week}.`,
    },
  });

  // Update form when data loads
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
      return (await unwrap(
        supabase
          .from("batches")
          .insert({
            name: values.name,
            recipe_id: values.recipe_id,
            planned_start_date: values.planned_start_date,
            volume_bbl: values.volume_bbl,
            status: "planned",
            notes: values.notes,
          })
          .select()
          .single()
      )) as unknown as { batch_code: string };
    },
    onSuccess: (data) => {
      toast.success(`Batch ${data.batch_code} created`);
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error) => {
      log.error("Create batch error:", error);
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

        <Form {...form}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="planned_start_date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Planned Start</FormLabel>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <FormControl>
                      <Input type="date" className="pl-9" {...field} />
                    </FormControl>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="recipe_id"
            render={({ field }) => (
              <FormItem>
            <FormLabel>Recipe</FormLabel>
            <Select
              value={field.value}
              onValueChange={field.onChange}
              disabled={recipesLoading}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder={recipesLoading ? "Loading..." : "Select recipe..."} />
                </SelectTrigger>
              </FormControl>
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
                          (<UnitDisplay value={recipe.batch_size_bbl} unitType="volume" decimals={1} />)
                        </span>
                      )}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <FormMessage />
            {selectedRecipe && (
              <p className="text-xs text-muted-foreground">
                Lead time: {scheduleDays(selectedRecipe).fermentationDays}{" "}
                fermentation + {scheduleDays(selectedRecipe).conditioningDays}{" "}
                conditioning days
              </p>
            )}
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Batch Name</FormLabel>
                <FormControl>
                  <Input placeholder="e.g., Hazy IPA #5" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="volume_bbl"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Volume (BBL)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="e.g., 10"
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

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
        </Form>
      </DialogContent>
    </Dialog>
  );
}
