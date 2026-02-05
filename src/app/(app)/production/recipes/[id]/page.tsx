"use client";

import { use, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { RecipeCloneDialog } from "@/components/domain/recipe-clone-dialog";
import { RecipeDeleteDialog } from "@/components/domain/recipe-delete-dialog";
import { StartBrewDayDialog } from "@/components/domain/start-brew-day-dialog";
import { recipeEntity } from "@/entities/recipe";
import { recipeKeys, entityKeys } from "@/lib/query-keys";

export default function RecipeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [showBrewDay, setShowBrewDay] = useState(false);
  const supabase = createClient();

  // Fetch recipe name for clone/delete dialogs
  const { data: recipe } = useQuery({
    queryKey: recipeKeys.detail(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipes")
        .select("name")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Handle custom actions
  const handleAction = useCallback((actionName: string) => {
    if (actionName === "start_brew_day") {
      setShowBrewDay(true);
      return true;
    }
    if (actionName === "clone") {
      setCloneDialogOpen(true);
      return true;
    }
    if (actionName === "delete") {
      setDeleteDialogOpen(true);
      return true;
    }
    return false;
  }, []);

  // Navigate to new recipe after successful clone
  const handleCloneSuccess = (newRecipeId: string) => {
    router.push(`/production/recipes/${newRecipeId}`);
  };

  const handleDeleteSuccess = () => {
    queryClient.invalidateQueries({ queryKey: entityKeys.all("recipes") });
    queryClient.invalidateQueries({ queryKey: entityKeys.all("recipes_with_estimates") });
    router.push("/production/recipes");
  };

  return (
    <>
      <EntityDetailUnifiedWithErrorBoundary
        entity={recipeEntity}
        id={id}
        basePath="/production/recipes"
        onAction={handleAction}
      />

      {recipe && (
        <>
          <StartBrewDayDialog
            recipeId={id}
            recipeName={recipe.name}
            open={showBrewDay}
            onOpenChange={setShowBrewDay}
            onSuccess={(brewLogId) => {
              setShowBrewDay(false);
              router.push(`/production/brew-logs/${brewLogId}`);
            }}
          />
          <RecipeCloneDialog
            recipeId={id}
            recipeName={recipe.name}
            open={cloneDialogOpen}
            onOpenChange={setCloneDialogOpen}
            onSuccess={handleCloneSuccess}
          />
          <RecipeDeleteDialog
            recipeId={id}
            recipeName={recipe.name}
            open={deleteDialogOpen}
            onOpenChange={setDeleteDialogOpen}
            onSuccess={handleDeleteSuccess}
          />
        </>
      )}
    </>
  );
}
