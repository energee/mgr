/**
 * FieldInput - Universal Field Input Component
 *
 * Renders a single form field with label, input, error, and description.
 * Handles all input types: text, textarea, number, select, multiselect,
 * relation, switch, checkbox, date, datetime, unit.
 *
 * Shared between EntityForm (legacy) and EntityDetailUnified (new).
 *
 * Accepts a minimal subset of UnifiedFieldDef's edit-mode properties (name,
 * label, type, required, colSpan, placeholder, description, disabled,
 * options, dynamicOptions, relation, unitType).
 *
 * Relation fields get an inline quick-create "+" button automatically when
 * the target entity is master data (see QUICK_CREATE_ENTITIES in
 * quick-create-dialog.tsx). An explicit `field.quickCreate` component takes
 * precedence; `disableQuickCreate` suppresses the button entirely (used by
 * QuickCreateDialog itself to prevent nested quick-creates).
 */

"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ComboboxField, ComboboxItem } from "@/components/ui/combobox";
import { DatePicker, DateTimePicker } from "@/components/ui/date-picker";
import { UnitInput } from "@/components/ui/unit-input";
import { useNumericInput } from "@/hooks/use-numeric-input";
import { useMemo, type FC } from "react";
import { getColSpanClass } from "./field-utils";
import { QuickCreateButton, isQuickCreateEntity } from "./quick-create-dialog";
import { log } from "@/lib/client-logger";

// =============================================================================
// Minimal field shape (compatible with UnifiedFieldDef)
// =============================================================================

type FieldDef = {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
  description?: string;
  required?: boolean;
  disabled?: boolean;
  colSpan?: number;
  fullWidth?: boolean;
  options?: { value: string; label: string }[];
  relation?: {
    entity: string;
    displayField: string;
  };
  unitType?: "volume" | "weight" | "temperature" | "gravity" | "retail_volume";
  quickCreate?: FC<{ onCreated: (id: string) => void }>;
}

// =============================================================================
// ARIA props for accessible form fields
// =============================================================================

type FieldAriaProps = {
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
}

// =============================================================================
// FieldInput Props
// =============================================================================

export type FieldInputProps = {
  /** Field definition (subset of UnifiedFieldDef) */
  field: FieldDef;

  /** Current field value */
  value: unknown;

  /** Error message for this field */
  error?: string;

  /** Change handler */
  onChange: (value: unknown) => void;

  /** Whether the input is disabled */
  disabled?: boolean;

  /** Dynamic/relation options fetched by useDynamicOptions */
  dynamicOptions?: { value: string; label: string }[];

  /**
   * Suppress the inline quick-create "+" button on relation fields (both the
   * auto-attached master-data button and any explicit field.quickCreate).
   * Used inside QuickCreateDialog to prevent nested quick-creates.
   */
  disableQuickCreate?: boolean;
}

// =============================================================================
// FieldInput Component (label + input + description + error)
// =============================================================================

export function FieldInput({
  field,
  value,
  error,
  onChange,
  disabled,
  dynamicOptions,
  disableQuickCreate,
}: FieldInputProps) {
  // Build aria-describedby from present elements
  const describedByParts: string[] = [];
  if (error) describedByParts.push(`${field.name}-error`);
  if (field.description) describedByParts.push(`${field.name}-description`);
  const describedBy = describedByParts.length > 0 ? describedByParts.join(" ") : undefined;

  const ariaProps: FieldAriaProps = {
    ...(describedBy && { "aria-describedby": describedBy }),
    ...(error && { "aria-invalid": true }),
    ...(field.required && { "aria-required": true }),
  };

  return (
    <div className={getColSpanClass(field.colSpan, field.fullWidth)}>
      {/* Required fields show an explicit asterisk below; no CSS `.required` rule exists. */}
      <Label htmlFor={field.name}>
        {field.label}
        {field.required && (
          <>
            <span className="text-destructive ml-1" aria-hidden="true">*</span>
            <span className="sr-only">(required)</span>
          </>
        )}
      </Label>

      <div className="mt-1.5">
        {renderFieldInput(field, value, onChange, disabled, dynamicOptions, ariaProps, disableQuickCreate)}
      </div>

      {field.description && (
        <p id={`${field.name}-description`} className="text-sm text-muted-foreground mt-1">
          {field.description}
        </p>
      )}

      {error && (
        <p id={`${field.name}-error`} role="alert" aria-live="polite" className="text-sm text-destructive mt-1">
          {error}
        </p>
      )}
    </div>
  );
}

// =============================================================================
// renderFieldInput - Renders the appropriate input based on field type
// =============================================================================

export function renderFieldInput(
  field: FieldDef,
  value: unknown,
  onChange: (value: unknown) => void,
  disabled?: boolean,
  dynamicOptions?: { value: string; label: string }[],
  ariaProps?: FieldAriaProps,
  disableQuickCreate?: boolean
) {
  switch (field.type) {
    case "text":
      return (
        <Input
          id={field.name}
          type="text"
          value={(value as string) || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          disabled={disabled}
          {...ariaProps}
        />
      );

    case "textarea":
      return (
        <Textarea
          id={field.name}
          value={(value as string) || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          disabled={disabled}
          {...ariaProps}
        />
      );

    case "number":
      return (
        <NumberFieldInput
          id={field.name}
          value={value}
          onChange={onChange}
          placeholder={field.placeholder}
          disabled={disabled}
          ariaProps={ariaProps}
        />
      );

    case "select": {
      // Use dynamic options if available, otherwise fall back to static options
      const options = dynamicOptions || field.options || [];
      // Check if any option uses _none sentinel (for nullable selects)
      const hasNoneSentinel = options.some((opt) => opt.value === "_none");
      // Use _none sentinel for null values if the options include it
      const selectValue = hasNoneSentinel && (value === null || value === undefined || value === "")
        ? "_none"
        : ((value as string) || "");
      return (
        <Select
          value={selectValue}
          onValueChange={(v) => onChange(v === "_none" ? null : v)}
          disabled={disabled}
        >
          <SelectTrigger id={field.name} {...ariaProps}>
            <SelectValue placeholder={field.placeholder || "Select..."} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    case "multiselect": {
      const options = dynamicOptions || field.options || [];
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div role="group" aria-label={field.label} className="flex flex-wrap gap-3" {...ariaProps}>
          {options.map((option) => {
            const checked = selected.includes(option.value);
            return (
              <label
                key={option.value}
                className="flex items-center gap-2 cursor-pointer"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(c) => {
                    const next = c
                      ? [...selected, option.value]
                      : selected.filter((v) => v !== option.value);
                    onChange(next);
                  }}
                  disabled={disabled}
                />
                <span className="text-sm">{option.label}</span>
              </label>
            );
          })}
        </div>
      );
    }

    case "relation": {
      const options = dynamicOptions || [];
      // Explicit per-field quickCreate component wins; otherwise auto-attach
      // the generic QuickCreateButton for master-data target entities.
      const QuickCreate = field.quickCreate;
      const autoQuickCreateEntity =
        !QuickCreate && isQuickCreateEntity(field.relation?.entity)
          ? field.relation!.entity
          : null;
      return (
        <div className="flex items-start gap-1.5">
          <RelationCombobox
            fieldName={field.name}
            placeholder={field.placeholder}
            required={field.required}
            disabled={disabled}
            value={value}
            options={options}
            onChange={onChange}
            ariaProps={ariaProps}
          />
          {!disabled && !disableQuickCreate && (
            QuickCreate ? (
              <QuickCreate onCreated={(id) => onChange(id)} />
            ) : autoQuickCreateEntity ? (
              <QuickCreateButton
                entityName={autoQuickCreateEntity}
                onCreated={(id) => onChange(id)}
              />
            ) : null
          )}
        </div>
      );
    }

    case "switch":
    case "checkbox":
      return (
        <Switch
          id={field.name}
          checked={Boolean(value)}
          onCheckedChange={onChange}
          disabled={disabled}
          {...ariaProps}
        />
      );

    case "date":
      return (
        <DatePicker
          id={field.name}
          value={(value as string) || undefined}
          onChange={onChange}
          disabled={disabled}
          placeholder={field.placeholder}
          {...ariaProps}
        />
      );

    case "datetime":
      return (
        <DateTimePicker
          id={field.name}
          value={(value as string) || undefined}
          onChange={onChange}
          disabled={disabled}
          placeholder={field.placeholder}
          {...ariaProps}
        />
      );

    case "unit":
      if (!field.unitType) {
        log.warn(`Field ${field.name} has type "unit" but no unitType specified`);
        // Fall back to a plain number input when no unitType is configured.
        return (
          <NumberFieldInput
            id={field.name}
            value={value}
            onChange={onChange}
            placeholder={field.placeholder}
            disabled={disabled}
            ariaProps={ariaProps}
          />
        );
      }
      return (
        <UnitInput
          value={value as number | null | undefined}
          onChange={onChange}
          unitType={field.unitType}
          placeholder={field.placeholder}
          disabled={disabled}
          {...ariaProps}
        />
      );

    default:
      return (
        <Input
          id={field.name}
          type="text"
          value={(value as string) || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          disabled={disabled}
          {...ariaProps}
        />
      );
  }
}

// =============================================================================
// NumberFieldInput — raw-string editing for number fields
// =============================================================================

/**
 * Number input that keeps the raw typed string in local state (via
 * useNumericInput) so in-progress entries like "-", ".", or "1.05" are never
 * reformatted or rendered as "NaN" by controlled re-renders. Commits a finite
 * number on every parseable keystroke and undefined for empty/in-progress
 * text; the visible text resyncs from the form value only while unfocused.
 */
function NumberFieldInput({
  id,
  value,
  onChange,
  placeholder,
  disabled,
  ariaProps,
}: {
  id: string;
  value: unknown;
  onChange: (value: unknown) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaProps?: FieldAriaProps;
}) {
  const { text, handleTextChange, handleFocus, handleBlur } = useNumericInput({
    formattedValue: value !== undefined && value !== null ? String(value) : "",
    // Number fields use undefined (not null) for "no value" to match the
    // optional-number zod schemas used by entity forms.
    onCommit: (parsed) => onChange(parsed ?? undefined),
  });

  return (
    <Input
      id={id}
      type="text"
      inputMode="decimal"
      value={text}
      onChange={(e) => handleTextChange(e.target.value)}
      onFocus={handleFocus}
      onBlur={handleBlur}
      placeholder={placeholder}
      disabled={disabled}
      {...ariaProps}
    />
  );
}

// =============================================================================
// RelationCombobox — manages inputValue state for diceui Combobox
// =============================================================================

/**
 * Wrapper around diceui Combobox that syncs the display text with the selected
 * value's label. The diceui Combobox doesn't auto-sync its input text when the
 * value changes programmatically (e.g. form.reset), so we manage inputValue
 * with local state, synced to the selected option's label.
 */
function RelationCombobox({
  fieldName,
  placeholder,
  required,
  disabled,
  value,
  options,
  onChange,
  ariaProps,
}: {
  fieldName: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  value: unknown;
  options: { value: string; label: string }[];
  onChange: (value: unknown) => void;
  ariaProps?: Record<string, unknown>;
}) {
  const labelByValue = useMemo(
    () => new Map(options.map((o) => [o.value, o.label])),
    [options]
  );

  const comboboxValue = value != null && value !== "" ? String(value) : undefined;
  const resolvedLabel = comboboxValue ? (labelByValue.get(comboboxValue) ?? "") : "";

  const onFilter = useMemo(
    () => (values: string[], inputValue: string) => {
      const q = inputValue.trim().toLowerCase();
      if (!q) return values;
      return values.filter((v) =>
        (labelByValue.get(v) ?? "").toLowerCase().includes(q)
      );
    },
    [labelByValue]
  );

  return (
    <ComboboxField
      className="flex-1"
      value={comboboxValue}
      selectedLabel={resolvedLabel}
      onValueChange={(v) => onChange(v || null)}
      onFilter={onFilter}
      disabled={disabled}
      id={fieldName}
      inputProps={ariaProps}
      placeholder={placeholder || "Search..."}
      emptyText="No results found"
      onClear={!required ? () => onChange(null) : undefined}
    >
      {options.map((option) => (
        <ComboboxItem key={option.value} value={option.value} label={option.label}>
          {option.label}
        </ComboboxItem>
      ))}
    </ComboboxField>
  );
}
