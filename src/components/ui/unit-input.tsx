"use client";

/**
 * Unit Input Component
 *
 * An input field that handles unit conversion between user display units
 * and canonical storage units. Optionally shows an inline unit switcher.
 *
 * While focused, the input holds the raw typed string (via useNumericInput)
 * so controlled re-renders never round or reformat in-progress entries;
 * formatSmartDecimal is applied only at rest (blur, external value change,
 * or unit switch). Commits are always finite canonical numbers or null.
 *
 * @see docs/MGR-SPECIFICATION.md Section 9 - Unit System
 */

import * as React from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatSmartDecimal } from "@/lib/format";
import { useNumericInput } from "@/hooks/use-numeric-input";
import { useUnitPreferences } from "@/hooks/use-unit-preferences";
import {
  getUnitOptions,
  getUnitLabel,
  getNextUnit,
  toDisplayValue,
  toCanonicalValue,
  type UnitType,
  type VolumeUnit,
  type WeightUnit,
  type TemperatureUnit,
  type GravityUnit,
  type RetailVolumeUnit,
} from "@/domain/units";

// =============================================================================
// Types
// =============================================================================

type AnyUnit =
  | VolumeUnit
  | WeightUnit
  | TemperatureUnit
  | GravityUnit
  | RetailVolumeUnit;

type UnitInputProps = Omit<React.ComponentProps<"input">, "value" | "onChange"> & {
  /** Canonical value (BBL, lbs, °F, Plato, oz) */
  value: number | null | undefined;
  /** Callback with canonical value */
  onChange: (canonicalValue: number | null) => void;
  /** Type of unit for conversion */
  unitType: UnitType;
  /** Show inline unit switcher (for recipe builder, brew log) */
  allowSwitch?: boolean;
  /** Number of decimal places for display */
  decimals?: number;
  /** Additional class for the wrapper */
  wrapperClassName?: string;
}

// =============================================================================
// Helper: Get preference key for unit type
// =============================================================================

type PreferenceKey = "volume_unit" | "weight_unit" | "temperature_unit" | "gravity_unit" | "retail_volume_unit";

function getPreferenceKey(unitType: UnitType): PreferenceKey {
  const map: Record<UnitType, PreferenceKey> = {
    volume: "volume_unit",
    weight: "weight_unit",
    temperature: "temperature_unit",
    gravity: "gravity_unit",
    retail_volume: "retail_volume_unit",
  };
  return map[unitType];
}

// =============================================================================
// Component
// =============================================================================

export function UnitInput({
  value,
  onChange,
  unitType,
  allowSwitch = false,
  decimals = 2,
  wrapperClassName,
  className,
  placeholder,
  disabled,
  onFocus,
  onBlur,
  ...props
}: UnitInputProps) {
  const { data: prefs, isLoading: prefsLoading } = useUnitPreferences();

  // Local unit override (for inline switcher)
  const [localUnit, setLocalUnit] = React.useState<AnyUnit | null>(null);

  // Determine which unit to use
  const preferenceKey = getPreferenceKey(unitType);
  const globalUnit = prefs?.[preferenceKey] as AnyUnit | undefined;
  const displayUnit = localUnit ?? globalUnit ?? getDefaultUnit(unitType);

  // Convert canonical value to a formatted display string. Applied to the
  // visible text only at resync points (blur, external change, unit switch) —
  // never while the user is typing, so extra decimals survive keystrokes.
  const formattedValue = React.useMemo(() => {
    if (value == null) return "";
    return formatSmartDecimal(toDisplayValue(value, unitType, displayUnit), decimals);
  }, [value, unitType, displayUnit, decimals]);

  const { text, handleTextChange, handleFocus, handleBlur } = useNumericInput({
    formattedValue,
    // A unit switch (inline switcher or global preference load) changes the
    // displayed magnitude, so force a resync even while the input is focused.
    resyncKey: displayUnit,
    // Commit finite display numbers as canonical; in-progress strings like
    // "-" or "." stay visible but commit null (never NaN).
    onCommit: (parsed) =>
      onChange(parsed == null ? null : toCanonicalValue(parsed, unitType, displayUnit)),
  });

  // Handle unit change (inline switcher)
  const handleUnitChange = (newUnit: string) => {
    setLocalUnit(newUnit as AnyUnit);
  };

  // Get unit options for switcher
  const unitOptions = getUnitOptions(unitType);

  // While preferences load, show disabled input with empty value (keeps it controlled)
  if (prefsLoading) {
    return (
      <div className={cn("flex gap-2", wrapperClassName)}>
        <Input disabled value="" className={cn("animate-pulse", className)} />
      </div>
    );
  }

  return (
    <div className={cn("flex gap-2", wrapperClassName)}>
      <Input
        type="text"
        inputMode="decimal"
        value={text}
        onChange={(e) => handleTextChange(e.target.value)}
        onFocus={(e) => {
          handleFocus();
          onFocus?.(e);
        }}
        onBlur={(e) => {
          handleBlur();
          onBlur?.(e);
        }}
        placeholder={placeholder}
        disabled={disabled}
        className={cn("flex-1", className)}
        {...props}
      />

      {allowSwitch ? (
        <Select
          value={displayUnit}
          onValueChange={handleUnitChange}
          disabled={disabled}
        >
          <SelectTrigger className="w-20" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {unitOptions.map((unit) => (
              <SelectItem key={unit} value={unit}>
                {getUnitLabel(unit)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="text-muted-foreground flex items-center justify-center w-12 text-sm">
          {getUnitLabel(displayUnit)}
        </span>
      )}
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function getDefaultUnit(unitType: UnitType): AnyUnit {
  switch (unitType) {
    case "volume":
      return "bbl";
    case "weight":
      return "lbs";
    case "temperature":
      return "f";
    case "gravity":
      return "plato";
    case "retail_volume":
      return "oz";
  }
}

// =============================================================================
// Display-only variant
// =============================================================================

type UnitDisplayProps = {
  /** Canonical value (BBL, lbs, °F, Plato, oz) — always convert from this, never from displayed value */
  value: number | null | undefined;
  unitType: UnitType;
  decimals?: number;
  className?: string;
}

/**
 * Display a value with unit conversion (read-only).
 * Click the unit label to cycle through available units.
 * Conversion always happens from the canonical `value` prop to prevent rounding drift.
 */
export function UnitDisplay({
  value,
  unitType,
  decimals = 2,
  className,
}: UnitDisplayProps) {
  const { data: prefs } = useUnitPreferences();
  const [localUnit, setLocalUnit] = React.useState<AnyUnit | null>(null);

  if (value == null) return <span className={className}>—</span>;

  const preferenceKey = getPreferenceKey(unitType);
  const prefValue = prefs?.[preferenceKey];
  const preferredUnit: AnyUnit =
    (prefValue as AnyUnit | undefined) ?? getDefaultUnit(unitType);
  const displayUnit = localUnit ?? preferredUnit;
  // Always convert from canonical value — never from a previously displayed value
  const displayValue = toDisplayValue(value, unitType, displayUnit);

  const cycleUnit = (e: React.MouseEvent) => {
    e.stopPropagation(); // Don't trigger row click in tables
    const next = getNextUnit(unitType, displayUnit);
    setLocalUnit(next as AnyUnit);
  };

  return (
    <span className={className}>
      {formatSmartDecimal(displayValue, decimals)}{" "}
      <button
        type="button"
        onClick={cycleUnit}
        className="cursor-pointer text-muted-foreground underline-offset-2 decoration-dotted hover:underline hover:text-foreground transition-colors"
        title={`Click to cycle units (${getUnitOptions(unitType).map(getUnitLabel).join(" → ")})`}
      >
        {getUnitLabel(displayUnit)}
      </button>
    </span>
  );
}
