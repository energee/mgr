"use client";

/**
 * New Vessel Transfer Page
 *
 * Supports two entry points that auto-populate from_vessel_id:
 * 1. Action button on batch detail (e.g. "Move to Conditioning") via prefill store
 * 2. Relation tab "Add" button via URL ?batch_id= query param
 *
 * When a batch_id is known, we fetch the batch to derive current_vessel_id
 * and auto-fill from_vessel_id (disabled). Direct navigation shows all fields editable.
 */

import { useState, useCallback, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { vesselTransferEntity } from "@/entities/vessel-transfer";
import { usePrefillStore } from "@/stores/prefill-store";
import type { UseFormReturn } from "react-hook-form";

export default function NewVesselTransferPage() {
  const searchParams = useSearchParams();

  // Consume prefill store (from action button) once on mount
  const [prefill] = useState(() => {
    const { prefillData } = usePrefillStore.getState().consume();
    return prefillData;
  });

  // Determine initial batch_id: prefill store takes priority, then URL param
  const initialBatchId = (prefill?.batch_id as string) || searchParams.get("batch_id") || null;

  // Track whether we need to fetch batch info for initial batch_id from URL
  // If prefill already has from_vessel_id, no need to fetch
  const needsInitialFetch = !!initialBatchId && !prefill?.from_vessel_id;
  const [initialBatchLoaded, setInitialBatchLoaded] = useState(!needsInitialFetch);
  const [defaultValues, setDefaultValues] = useState<Record<string, unknown>>(() => {
    if (prefill) return { ...prefill };
    if (initialBatchId) return { batch_id: initialBatchId };
    return {};
  });

  // Track whether from_vessel_id was auto-derived (to disable the field)
  const [disabledFields, setDisabledFields] = useState<string[]>(() => {
    // If prefill provided from_vessel_id, start disabled
    if (prefill?.from_vessel_id) return ["from_vessel_id"];
    return [];
  });

  // Fetch batch data to derive from_vessel_id for the initial batch_id (URL param case)
  useEffect(() => {
    if (!needsInitialFetch || initialBatchLoaded) return;

    const supabase = createClient();
    supabase
      .from("batches_with_brew_info")
      .select("current_vessel_id, volume_bbl")
      .eq("id", initialBatchId!)
      .single()
      .then(({ data }) => {
        if (data) {
          setDefaultValues((prev) => ({
            ...prev,
            from_vessel_id: data.current_vessel_id,
            ...(!prev.volume_bbl && data.volume_bbl ? { volume_bbl: data.volume_bbl } : {}),
          }));
          if (data.current_vessel_id) {
            setDisabledFields(["from_vessel_id"]);
          }
        }
        setInitialBatchLoaded(true);
      });
  }, [needsInitialFetch, initialBatchLoaded, initialBatchId]);

  // Handle field changes - when batch_id changes, auto-derive from_vessel_id
  const handleFieldChange = useCallback(
    (
      fieldName: string,
      value: unknown,
      form: UseFormReturn<Record<string, unknown>>,
    ) => {
      if (fieldName !== "batch_id") return;

      if (!value) {
        // Batch cleared - reset from_vessel_id and make it editable
        form.setValue("from_vessel_id", null);
        setDisabledFields([]);
        return;
      }

      // Fetch the batch to get its current vessel
      const supabase = createClient();
      supabase
        .from("batches_with_brew_info")
        .select("current_vessel_id, volume_bbl")
        .eq("id", value as string)
        .single()
        .then(({ data }) => {
          if (data) {
            form.setValue("from_vessel_id", data.current_vessel_id);
            if (data.volume_bbl) {
              form.setValue("volume_bbl", data.volume_bbl);
            }
            if (data.current_vessel_id) {
              setDisabledFields(["from_vessel_id"]);
            } else {
              setDisabledFields([]);
            }
          }
        });
    },
    [],
  );

  // Don't render form until initial batch data is loaded (avoids flash of empty fields)
  if (!initialBatchLoaded) return null;

  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={vesselTransferEntity}
      basePath="/production/vessel-transfers"
      defaultValues={defaultValues}
      disabledFields={disabledFields}
      onFieldChange={handleFieldChange}
    />
  );
}
