"use client";

/**
 * Recipe Schedule Edit Wrappers
 *
 * Bridges MashScheduleEditor and FermentationScheduleEditor to the
 * editComponent interface ({ data, editing, form }) used by UnifiedSectionCard.
 * Reads/writes the JSONB fields on the recipe form via react-hook-form.
 */

import type { UseFormReturn } from "react-hook-form";
import { MashScheduleEditor, type MashStep } from "./mash-schedule-editor";
import { FermentationScheduleEditor, type FermentationStage } from "./fermentation-schedule-editor";

// Matches the editComponent interface: { data: T; editing?: boolean; form?: unknown }
interface ScheduleEditProps {
  data: Record<string, unknown>;
  editing?: boolean;
  form?: unknown;
}

/**
 * Edit wrapper for mash schedule — reads/writes form's mash_schedule field.
 */
export function MashScheduleEditWrapper({ form: rawForm }: ScheduleEditProps) {
  const form = rawForm as UseFormReturn<Record<string, unknown>> | undefined;
  const steps = (form?.watch("mash_schedule") ?? []) as MashStep[];

  return (
    <MashScheduleEditor
      steps={steps}
      onChange={(newSteps) => {
        form?.setValue("mash_schedule", newSteps, { shouldDirty: true });
      }}
    />
  );
}

/**
 * Edit wrapper for fermentation schedule — reads/writes form's fermentation_schedule field.
 */
export function FermentationScheduleEditWrapper({ form: rawForm }: ScheduleEditProps) {
  const form = rawForm as UseFormReturn<Record<string, unknown>> | undefined;
  const stages = (form?.watch("fermentation_schedule") ?? []) as FermentationStage[];

  return (
    <FermentationScheduleEditor
      stages={stages}
      onChange={(newStages) => {
        form?.setValue("fermentation_schedule", newStages, { shouldDirty: true });
      }}
    />
  );
}
