/**
 * FieldDisplay - Universal Field Display Component
 *
 * Renders a single field label + value pair in view mode.
 * Handles text, formatted values (date, datetime, currency, number, percentage, unit),
 * relation values (FK display via pre-fetched relation map), custom render functions,
 * state/value display labels, JSON values, booleans, and null/undefined.
 *
 * Shared between EntityDetail (legacy) and EntityDetailUnified (new).
 */

import type { ReactNode } from "react";
import { formatValue } from "@/lib/utils";
import type { EntityConfig, UnifiedFieldDef } from "@/types/entity";
import { getStateLabel } from "@/types/entity";
import { UnitDisplay } from "@/components/ui/unit-input";
import { getColSpanClass } from "./field-utils";

export interface FieldDisplayProps<T = Record<string, unknown>> {
  /** Unified field definition (uses `name` as key) */
  field: UnifiedFieldDef<T>;
  /** The raw value for this field */
  value: unknown;
  /** The full record (passed to custom render functions) */
  record: T;
  /** Entity config (used for state machine label lookup) */
  entity: EntityConfig<T>;
  /** Pre-fetched relation display values keyed by field name */
  relationDisplayValues?: Record<string, string>;
  /** Fetched dynamic options (from useDynamicOptions) for resolving UUIDs to labels */
  dynamicOptions?: { value: string; label: string }[];
}

export function FieldDisplay<T = Record<string, unknown>>({
  field,
  value,
  record,
  entity,
  relationDisplayValues,
  dynamicOptions,
}: FieldDisplayProps<T>) {
  const displayValue = resolveDisplayValue(field, value, record, entity, relationDisplayValues, dynamicOptions);

  return (
    <div className={getColSpanClass(field.colSpan, field.fullWidth)}>
      <dt className="text-sm font-medium text-muted-foreground">
        {field.label}
      </dt>
      <dd className="mt-1">{displayValue}</dd>
    </div>
  );
}

/**
 * Resolve the display value for a field.
 *
 * Priority:
 * 1. Custom render function
 * 2. State machine field (label from stateDisplay)
 * 3. Relation display value (pre-fetched FK name)
 * 4. Dynamic options (UUID to label)
 * 5. Select options (key to label)
 * 6. Unit display (interactive conversion component)
 * 7. Default formatValue (date, datetime, currency, number, percentage, json, boolean, null)
 */
export function resolveDisplayValue<T = Record<string, unknown>>(
  field: UnifiedFieldDef<T>,
  value: unknown,
  record: T,
  entity: EntityConfig<T>,
  relationDisplayValues?: Record<string, string>,
  dynamicOptions?: { value: string; label: string }[],
): ReactNode {
  if (field.render) {
    return field.render(value, record);
  }

  if (entity.stateMachine?.stateField === field.name && typeof value === "string") {
    return getStateLabel(entity, value);
  }

  if (field.relation && relationDisplayValues?.[field.name]) {
    return relationDisplayValues[field.name];
  }

  if (dynamicOptions && typeof value === "string") {
    const opt = dynamicOptions.find((o) => o.value === value);
    if (opt) return opt.label;
  }

  if (field.options && typeof value === "string") {
    const opt = field.options.find((o) => o.value === value);
    if (opt) return opt.label;
  }

  if (field.format === "unit" && field.unitType) {
    return <UnitDisplay value={value as number | null} unitType={field.unitType} />;
  }

  return formatValue(value, field.format);
}
