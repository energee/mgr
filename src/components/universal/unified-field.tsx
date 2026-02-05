/**
 * UnifiedField - Delegates to FieldDisplay or FieldInput
 *
 * Simple wrapper that renders a field in either view mode (FieldDisplay)
 * or edit mode (FieldInput) based on editing state and field editability.
 *
 * Bridges react-hook-form's Controller to FieldInput's value/onChange/error
 * interface.
 */

"use client";

import { Controller } from "react-hook-form";
import { FieldDisplay } from "./field-display";
import { FieldInput } from "./field-input";
import type { UnifiedFieldDef, EntityConfig } from "@/types/entity";
import type { UseFormReturn } from "react-hook-form";

interface UnifiedFieldProps {
  field: UnifiedFieldDef<Record<string, unknown>>;
  editing: boolean;
  isCreateMode: boolean;
  form?: UseFormReturn<Record<string, unknown>>;
  record: Record<string, unknown>;
  entity: EntityConfig<Record<string, unknown>>;
  relationDisplayValues?: Record<string, string>;
  dynamicOptions?: { value: string; label: string }[];
}

export function UnifiedField({
  field,
  editing,
  isCreateMode,
  form,
  record,
  entity,
  relationDisplayValues,
  dynamicOptions,
}: UnifiedFieldProps) {
  const isEditable = (() => {
    if (!editing) return false;
    if (field.editable === false) return false;
    if (field.editable === "create-only" && !isCreateMode) return false;
    if (!field.type) return false;
    return true;
  })();

  if (isEditable && form) {
    return (
      <Controller
        control={form.control}
        name={field.name}
        render={({ field: formField, fieldState }) => (
          <FieldInput
            field={field}
            value={formField.value}
            error={fieldState.error?.message}
            onChange={formField.onChange}
            disabled={field.disabled}
            dynamicOptions={dynamicOptions}
          />
        )}
      />
    );
  }

  return (
    <FieldDisplay
      field={field}
      value={record[field.name]}
      record={record}
      entity={entity}
      relationDisplayValues={relationDisplayValues}
    />
  );
}
