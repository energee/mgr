"use client";

/**
 * Unit Input Component
 *
 * An input field that handles unit conversion between user display units
 * and canonical storage units. Optionally shows an inline unit switcher.
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
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
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
} from "@/lib/units";

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
  ...props
}: UnitInputProps) {
  const { data: prefs, isLoading: prefsLoading } = useUnitPreferences();

  // Local unit override (for inline switcher)
  const [localUnit, setLocalUnit] = React.useState<AnyUnit | null>(null);

  // Determine which unit to use
  const preferenceKey = getPreferenceKey(unitType);
  const globalUnit = prefs?.[preferenceKey] as AnyUnit | undefined;
  const displayUnit = localUnit ?? globalUnit ?? getDefaultUnit(unitType);

  // Convert canonical value to display value
  const displayValue = React.useMemo(() => {
    if (value == null) return "";
    return formatSmartDecimal(toDisplayValue(value, unitType, displayUnit), decimals);
  }, [value, unitType, displayUnit, decimals]);

  // Handle input change
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;

    if (inputValue === "" || inputValue === "-") {
      onChange(null);
      return;
    }

    const parsed = parseFloat(inputValue);
    if (!isNaN(parsed)) {
      const canonical = toCanonicalValue(parsed, unitType, displayUnit);
      onChange(canonical);
    }
  };

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
        value={displayValue}
        onChange={handleInputChange}
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
