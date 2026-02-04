"use client";

import { use } from "react";
import { redirect } from "next/navigation";

/**
 * Edit page now redirects to the recipe builder which handles editing inline.
 */
export default function EditRecipePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  redirect(`/production/recipes/${id}`);
}
