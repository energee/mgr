/**
 * FieldInput - Universal Field Input Component
 *
 * Renders a single form field with label, input, error, and description.
 * Handles all input types: text, textarea, number, select, multiselect,
 * relation, switch, checkbox, date, datetime, unit.
 *
 * Shared between EntityForm (legacy) and EntityDetailUnified (new).
 *
 * Accepts both EntityFieldDef and UnifiedFieldDef since they share the same
 * property names for edit-mode fields (name, label, type, required, colSpan,
 * placeholder, description, disabled, options, dynamicOptions, relation,
 * unitType, allowUnitSwitch).
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
import {
  Combobox,
  ComboboxAnchor,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxTrigger,
} from "@/components/ui/combobox";
import { DatePicker, DateTimePicker } from "@/components/ui/date-picker";
import { UnitInput } from "@/components/ui/unit-input";
import { X } from "lucide-react";
import { useState, useEffect, useMemo, type FC } from "react";
import { getColSpanClass } from "./field-utils";
import { log } from "@/lib/client-logger";

// =============================================================================
// Minimal field shape (compatible with both EntityFieldDef and UnifiedFieldDef)
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
  allowUnitSwitch?: boolean;
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
  /** Field definition (EntityFieldDef or UnifiedFieldDef) */
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
      <Label htmlFor={field.name} className={field.required ? "required" : ""}>
        {field.label}
        {field.required && (
          <>
            <span className="text-destructive ml-1" aria-hidden="true">*</span>
            <span className="sr-only">(required)</span>
          </>
        )}
      </Label>

      <div className="mt-1.5">
        {renderFieldInput(field, value, onChange, disabled, dynamicOptions, ariaProps)}
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
  ariaProps?: FieldAriaProps
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
        <Input
          id={field.name}
          type="text"
          inputMode="decimal"
          value={value !== undefined && value !== null ? String(value) : ""}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
          placeholder={field.placeholder}
          disabled={disabled}
          {...ariaProps}
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
      const QuickCreate = field.quickCreate;
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
          {QuickCreate && !disabled && (
            <QuickCreate onCreated={(id) => onChange(id)} />
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
        return (
          <Input
            id={field.name}
            type="text"
            inputMode="decimal"
            value={value !== undefined && value !== null ? String(value) : ""}
            onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
            placeholder={field.placeholder}
            disabled={disabled}
            {...ariaProps}
          />
        );
      }
      return (
        <UnitInput
          value={value as number | null | undefined}
          onChange={onChange}
          unitType={field.unitType}
          allowSwitch={field.allowUnitSwitch}
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

  const [inputText, setInputText] = useState(resolvedLabel);

  // Sync display text when value or options change (e.g. form.reset, options load)
  useEffect(() => {
    setInputText(resolvedLabel);
  }, [resolvedLabel]);

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
    <Combobox
      className="flex-1"
      value={comboboxValue}
      inputValue={inputText}
      onInputValueChange={setInputText}
      onValueChange={(v) => onChange(v || null)}
      onFilter={onFilter}
      disabled={disabled}
    >
      <ComboboxAnchor>
        <ComboboxInput
          id={fieldName}
          placeholder={placeholder || "Search..."}
          {...ariaProps}
        />
        {!required && !!value && (
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setInputText("");
            }}
            className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2"
            aria-label="Clear selection"
          >
            <X className="size-3.5" />
          </button>
        )}
        <ComboboxTrigger />
      </ComboboxAnchor>
      <ComboboxContent>
        <ComboboxEmpty>No results found</ComboboxEmpty>
        {options.map((option) => (
          <ComboboxItem key={option.value} value={option.value} label={option.label}>
            {option.label}
          </ComboboxItem>
        ))}
      </ComboboxContent>
    </Combobox>
  );
}
