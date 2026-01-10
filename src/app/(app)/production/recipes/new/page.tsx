"use client";

import { EntityForm } from "@/components/universal/entity-form";
import { recipeEntity } from "@/entities/recipe";

export default function NewRecipePage() {
  return <EntityForm entity={recipeEntity} basePath="/production/recipes" />;
}
