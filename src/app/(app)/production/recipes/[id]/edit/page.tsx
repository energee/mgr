"use client";

import { use } from "react";
import { EntityForm } from "@/components/universal/entity-form";
import { recipeEntity } from "@/entities/recipe";

export default function EditRecipePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EntityForm entity={recipeEntity} id={id} basePath="/production/recipes" />;
}
