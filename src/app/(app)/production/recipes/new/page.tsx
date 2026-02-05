"use client";

import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { recipeEntity } from "@/entities/recipe";

export default function NewRecipePage() {
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={recipeEntity}
      basePath="/production/recipes"
    />
  );
}
