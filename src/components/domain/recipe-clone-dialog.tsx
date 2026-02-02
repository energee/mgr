"use client";

/**
 * RecipeCloneDialog - Clone a recipe or template
 *
 * Creates a copy of an existing recipe, optionally:
 * - Changing the name
 * - Linking to a different brand
 * - Setting as non-template if cloning from a template
 */

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
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
import { Loader2, Copy } from "lucide-react";
import { toast } from "sonner";
import { recipeKeys } from "@/lib/query-keys";
import { useBrands } from "@/hooks/use-catalog";

// =============================================================================
// Types
// =============================================================================

const cloneSchema = z.object({
  name: z.string().min(1, "Name is required"),
  brand_id: z.string().uuid().nullable().optional(),
});

type CloneFormValues = z.infer<typeof cloneSchema>;

interface RecipeCloneDialogProps {
  recipeId: string;
  recipeName: string;
  isTemplate?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (newRecipeId: string) => void;
}

// =============================================================================
// Component
// =============================================================================

export function RecipeCloneDialog({
  recipeId,
  recipeName,
  isTemplate = false,
  open,
  onOpenChange,
  onSuccess,
}: RecipeCloneDialogProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  // Fetch brands for selection
  const { data: brands } = useBrands();

  // Form
  const form = useForm<CloneFormValues>({
    resolver: zodResolver(cloneSchema),
    defaultValues: {
      name: `${recipeName} (Copy)`,
      brand_id: null,
    },
  });

  // Clone mutation
  const cloneMutation = useMutation({
    mutationFn: async (values: CloneFormValues) => {
      // 1. Get source recipe
      const { data: source, error: sourceError } = await supabase
        .from("recipes")
        .select("*")
        .eq("id", recipeId)
        .single();

      if (sourceError) throw sourceError;

      // 2. Create new recipe (excluding server-managed fields)
      const { id, created_at, updated_at, ...recipeData } = source;
      void id; void created_at; void updated_at;
      const newRecipe = {
        ...recipeData,
        name: values.name,
        brand_id: values.brand_id || recipeData.brand_id,
        is_template: false, // Cloned recipes are not templates
      };

      const { data: cloned, error: cloneError } = await supabase
        .from("recipes")
        .insert(newRecipe)
        .select("id")
        .single();

      if (cloneError) throw cloneError;

      // 3. Clone all junction tables (ingredients)
      await Promise.all([
        cloneJunctionTable("recipe_malts", recipeId, cloned.id),
        cloneJunctionTable("recipe_hops", recipeId, cloned.id),
        cloneJunctionTable("recipe_additions", recipeId, cloned.id),
        cloneJunctionTable("recipe_adjuncts", recipeId, cloned.id),
        cloneJunctionTable("recipe_sugars", recipeId, cloned.id),
        cloneJunctionTable("recipe_spices", recipeId, cloned.id),
        cloneJunctionTable("recipe_fruits", recipeId, cloned.id),
        cloneJunctionTable("recipe_yeasts", recipeId, cloned.id),
      ]);

      return cloned.id;
    },
    onSuccess: (newId) => {
      queryClient.invalidateQueries({ queryKey: recipeKeys.all() });
      toast.success("Recipe cloned successfully");
      onOpenChange(false);
      onSuccess?.(newId);
    },
    onError: (error) => {
      console.error("Clone error:", error);
      const message = error instanceof Error ? error.message : "Failed to clone recipe";
      toast.error(message);
    },
  });

  // All junction tables that need to be cloned
  type JunctionTable =
    | "recipe_malts"
    | "recipe_hops"
    | "recipe_additions"
    | "recipe_adjuncts"
    | "recipe_sugars"
    | "recipe_spices"
    | "recipe_fruits"
    | "recipe_yeasts";

  // Helper to clone junction tables - throws on error for proper error handling
  const cloneJunctionTable = async (
    table: JunctionTable,
    sourceRecipeId: string,
    targetRecipeId: string
  ) => {
    const { data: rows, error: fetchError } = await supabase
      .from(table)
      .select("*")
      .eq("recipe_id", sourceRecipeId);

    if (fetchError) {
      throw new Error(`Failed to fetch ${table}: ${fetchError.message}`);
    }

    if (rows && rows.length > 0) {
      const newRows = rows.map((row) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id, recipe_id, created_at, updated_at, ...data } = row as Record<string, unknown>;
        return { ...data, recipe_id: targetRecipeId };
      });

      const { error: insertError } = await supabase.from(table).insert(newRows as never);
      if (insertError) {
        throw new Error(`Failed to clone ${table}: ${insertError.message}`);
      }
    }
  };

  const handleSubmit = form.handleSubmit((values) => {
    cloneMutation.mutate(values);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="h-5 w-5" />
            Clone {isTemplate ? "Template" : "Recipe"}
          </DialogTitle>
          <DialogDescription>
            Create a copy of &quot;{recipeName}&quot; with a new name.
            {isTemplate && " The cloned recipe will not be a template."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">New Recipe Name</Label>
            <Input
              id="name"
              {...form.register("name")}
              placeholder="Enter recipe name..."
              className="min-h-[44px]"
            />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive">
                {form.formState.errors.name.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="brand_id">Brand (optional)</Label>
            <Select
              value={form.watch("brand_id") || "_keep_original"}
              onValueChange={(v) => form.setValue("brand_id", v === "_keep_original" ? null : v)}
            >
              <SelectTrigger className="min-h-[44px]">
                <SelectValue placeholder="Keep original brand" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_keep_original">Keep original brand</SelectItem>
                {brands?.map((brand) => (
                  <SelectItem key={brand.id} value={brand.id}>
                    {brand.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="min-h-[44px]"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={cloneMutation.isPending}
              className="min-h-[44px]"
            >
              {cloneMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Cloning...
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 mr-2" />
                  Clone Recipe
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
