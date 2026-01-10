"use client";

import { EntityList } from "@/components/universal/entity-list";
import { recipeEntity } from "@/entities/recipe";

export default function RecipesPage() {
  return <EntityList entity={recipeEntity} basePath="/production/recipes" />;
}
