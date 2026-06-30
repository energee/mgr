"use client";

/**
 * New Batch Page
 *
 * Generic batch creation form with recipe-driven smart defaults:
 * - consumes prefill-store defaults (AI chat navigation, the recipe
 *   "Plan Batch" action/button)
 * - when the user picks a recipe in the form, derives the batch name
 *   ("{brand} - {recipe}") and volume from the recipe's batch_size_bbl
 *   (same convention as CreateBatchFromShortfall); both stay editable.
 */

import { useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { batchEntity } from "@/entities/batch";
import { usePrefillStore } from "@/contexts/prefill-store";
import type { UseFormReturn } from "react-hook-form";

export default function NewBatchPage() {
  const [defaultValues] = useState(() => {
    const { prefillData } = usePrefillStore.getState().consume();
    return prefillData ?? undefined;
  });

  // When recipe_id changes, derive name and volume_bbl from the recipe.
  // Fires only on user edits (not on prefilled defaults), so values staged
  // by "Plan Batch" are not refetched or clobbered on mount.
  const handleFieldChange = useCallback(
    (
      fieldName: string,
      value: unknown,
      form: UseFormReturn<Record<string, unknown>>,
    ) => {
      if (fieldName !== "recipe_id" || !value) return;

      const supabase = createClient();
      supabase
        .from("recipes")
        .select("name, batch_size_bbl, brands(name)")
        .eq("id", value as string)
        .single()
        .then(({ data }) => {
          if (!data) return;
          const brandName =
            (data.brands as { name: string } | null)?.name ?? null;
          form.setValue(
            "name",
            brandName ? `${brandName} - ${data.name}` : data.name,
          );
          if (data.batch_size_bbl != null) {
            form.setValue("volume_bbl", data.batch_size_bbl);
          }
        });
    },
    [],
  );

  return (
    <EntityDetailPage
      entity={batchEntity}
      basePath="/production/batches"
      defaultValues={defaultValues}
      onFieldChange={handleFieldChange}
    />
  );
}
