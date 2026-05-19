/**
 * Recipe Detail Page - Purpose-built recipe editor.
 *
 * Uses the RecipeEditorPage component instead of the generic EntityDetailUnified,
 * providing an always-editable two-column layout with live estimate sidebar.
 * The recipe entity config is still used for the list page and state machine.
 */

"use client";

import { use } from "react";
import { RecipeEditorPage } from "@/components/domain/recipe/recipe-editor/recipe-editor-page";

export default function RecipeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <RecipeEditorPage id={id} />;
}
