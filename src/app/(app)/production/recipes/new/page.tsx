"use client";

import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { recipeEntity } from "@/entities/recipe";

export default function NewRecipePage() {
  return (
    <EntityDetailPage
      entity={recipeEntity}
      basePath="/production/recipes"
    />
  );
}
