"use client";

/**
 * New Vessel Transfer Page
 *
 * Generic vessel transfer creation form. For batch-specific transfers
 * (e.g., "Move to Conditioning"), use the VesselTransferDialog from
 * the batch detail page instead.
 */

import { useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { vesselTransferEntity } from "@/entities/vessel-transfer";
import type { UseFormReturn } from "react-hook-form";

export default function NewVesselTransferPage() {
  // When batch_id changes, auto-derive from_vessel_id
  const handleFieldChange = useCallback(
    (
      fieldName: string,
      value: unknown,
      form: UseFormReturn<Record<string, unknown>>,
    ) => {
      if (fieldName !== "batch_id") return;

      if (!value) {
        form.setValue("from_vessel_id", null);
        return;
      }

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
          }
        });
    },
    [],
  );

  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={vesselTransferEntity}
      basePath="/production/vessel-transfers"
      onFieldChange={handleFieldChange}
    />
  );
}
