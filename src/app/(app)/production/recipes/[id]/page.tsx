"use client";

import { use } from "react";
import { RecipeBuilder } from "@/components/domain/recipe-builder";

export default function RecipeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <RecipeBuilder recipeId={id} />;
}
