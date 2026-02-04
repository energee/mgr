"use client";

import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { EntityList } from "@/components/universal/entity-list";
import { RecipeDeleteDialog } from "@/components/domain/recipe-delete-dialog";
import { recipeEntity } from "@/entities/recipe";
import { entityKeys } from "@/lib/query-keys";

interface RecipeRecord {
  id: string;
  name: string;
}

export default function RecipesPage() {
  const queryClient = useQueryClient();
  const [selectedRecipe, setSelectedRecipe] = useState<RecipeRecord | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleAction = useCallback((actionName: string, record: any) => {
    if (actionName === "delete") {
      setSelectedRecipe(record as RecipeRecord);
      setDeleteDialogOpen(true);
      return true;
    }
    return false;
  }, []);

  const handleDeleteSuccess = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: entityKeys.all("recipes") });
    queryClient.invalidateQueries({ queryKey: entityKeys.all("recipes_with_estimates") });
  }, [queryClient]);

  return (
    <>
      <EntityList
        entity={recipeEntity}
        basePath="/production/recipes"
        onAction={handleAction}
      />

      {selectedRecipe && (
        <RecipeDeleteDialog
          recipeId={selectedRecipe.id}
          recipeName={selectedRecipe.name}
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          onSuccess={handleDeleteSuccess}
        />
      )}
    </>
  );
}
