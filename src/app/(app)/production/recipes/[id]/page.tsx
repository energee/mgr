"use client";

import { use, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { RecipeCloneDialog } from "@/components/domain/recipe-clone-dialog";
import { StartBrewDayDialog } from "@/components/domain/start-brew-day-dialog";
import { recipeEntity } from "@/entities/recipe";
import { recipeKeys } from "@/lib/query-keys";

export default function RecipeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const [showBrewDay, setShowBrewDay] = useState(false);
  const supabase = createClient();

  // Fetch recipe name for clone dialog
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
    return false;
  }, []);

  // Navigate to new recipe after successful clone
  const handleCloneSuccess = (newRecipeId: string) => {
    router.push(`/production/recipes/${newRecipeId}`);
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
        </>
      )}
    </>
  );
}
