/**
 * UnifiedField - Delegates to FieldDisplay or FieldInput
 *
 * Renders a field in either view mode (FieldDisplay) or edit mode (FieldInput)
 * based on editing state and field editability. Bridges react-hook-form's
 * Controller to FieldInput's value/onChange/error interface.
 *
 * Conditional visibility (UnifiedFieldDef.showWhen) is evaluated upstream in
 * FieldGrid (entity-detail-unified.tsx): hidden fields are never passed here,
 * so this component only decides HOW a visible field renders, not WHETHER.
 */

"use client";

import { Controller } from "react-hook-form";
import { FieldDisplay } from "./field-display";
import { FieldInput } from "./field-input";
import { createModeStateOptions } from "@/types/entity";
import type { UnifiedFieldDef, EntityConfig } from "@/types/entity";
import type { UseFormReturn } from "react-hook-form";

type UnifiedFieldProps = {
  field: UnifiedFieldDef<Record<string, unknown>>;
  editing: boolean;
  isCreateMode: boolean;
  form?: UseFormReturn<Record<string, unknown>>;
  record: Record<string, unknown>;
  entity: EntityConfig<Record<string, unknown>>;
  relationDisplayValues?: Record<string, string>;
  dynamicOptions?: { value: string; label: string }[];
}

/**
 * Determine whether a field should render in edit mode.
 * A field is editable when: editing is on, the field has a type,
 * it is not explicitly non-editable, and create-only fields are
 * only editable during creation.
 *
 * State-machine state fields (entity.stateMachine.stateField) are locked
 * when editing an existing record: status changes must go through the
 * guarded transition path (Actions menu), which validates the transition
 * and runs side effects — a plain form save does neither. Create mode is
 * untouched so initial-state selection still works.
 *
 * Exported for the entity-registry test that asserts every state field is
 * covered by this lock (src/entities/__tests__/state-field-lock.test.ts).
 */
export function isFieldEditable(
  field: UnifiedFieldDef<Record<string, unknown>>,
  editing: boolean,
  isCreateMode: boolean,
  entity?: EntityConfig<Record<string, unknown>>,
): boolean {
  if (!editing || !field.type) return false;
  if (field.editable === false) return false;
  if (field.editable === "create-only" && !isCreateMode) return false;
  if (
    !isCreateMode &&
    entity?.stateMachine &&
    field.name === entity.stateMachine.stateField
  ) {
    return false;
  }
  return true;
}

/**
 * Whether this field is a state-machine state field being rendered in create
 * mode. Such fields may only offer the machine's initial state — creating a
 * record directly in a later state bypasses transition validation and side
 * effects (audit EA-1; see createModeStateOptions in types/entity.ts).
 *
 * Exported for the entity-registry test that asserts every create-editable
 * state select is clamped (src/entities/__tests__/create-mode-state.test.ts).
 */
export function isCreateModeStateField(
  field: UnifiedFieldDef<Record<string, unknown>>,
  isCreateMode: boolean,
  entity?: EntityConfig<Record<string, unknown>>,
): boolean {
  return (
    isCreateMode &&
    !!entity?.stateMachine &&
    field.name === entity.stateMachine.stateField
  );
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
  // Create mode: clamp the state field's choices to the initial state (EA-1).
  // dynamicOptions are suppressed for it too — FieldInput prefers them over
  // static options, which would defeat the clamp.
  const stateClamped = isCreateModeStateField(field, isCreateMode, entity);
  const effectiveField =
    stateClamped && entity.stateMachine
      ? {
          ...field,
          options: createModeStateOptions(entity.stateMachine, field.options),
        }
      : field;

  if (isFieldEditable(field, editing, isCreateMode, entity) && form) {
    return (
      <Controller
        control={form.control}
        name={field.name}
        render={({ field: formField, fieldState }) => (
          <FieldInput
            field={effectiveField}
            value={formField.value}
            error={fieldState.error?.message}
            onChange={formField.onChange}
            disabled={field.disabled}
            dynamicOptions={stateClamped ? undefined : dynamicOptions}
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
      dynamicOptions={dynamicOptions}
    />
  );
}
