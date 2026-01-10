"use client";

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { recipeEntity } from "@/entities/recipe";

export default function RecipeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityDetail entity={recipeEntity} id={id} basePath="/production/recipes" />;
}
