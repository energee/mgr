/**
 * Unit Conversion Library
 *
 * Handles conversion between canonical storage units and user display units.
 * All database storage uses canonical units (BBL, lbs, °F, Plato, oz).
 * User preferences determine display/input units.
 *
 * @see docs/MGR-SPECIFICATION.md Section 9 - Unit System
 */

// =============================================================================
// Type Definitions
// =============================================================================

export type VolumeUnit = "bbl" | "gal" | "l" | "hl";
export type RetailVolumeUnit = "oz" | "ml";
export type WeightUnit = "lbs" | "kg";
export type TemperatureUnit = "f" | "c";
export type GravityUnit = "plato" | "sg";

export type UnitType =
  | "volume"
  | "retail_volume"
  | "weight"
  | "temperature"
  | "gravity";

// =============================================================================
// Conversion Constants
// =============================================================================

/** Volume conversions relative to BBL (1 BBL = base) */
export const VOLUME_CONVERSIONS: Record<VolumeUnit, number> = {
  bbl: 1,
  gal: 31, // 1 BBL = 31 US gallons
  l: 117.348, // 1 BBL = 117.348 liters
  hl: 1.17348, // 1 BBL = 1.17348 hectoliters
};

/** Retail volume conversions relative to oz (1 oz = base) */
export const RETAIL_VOLUME_CONVERSIONS: Record<RetailVolumeUnit, number> = {
  oz: 1,
  ml: 29.5735, // 1 oz = 29.5735 ml
};

/** Weight conversions relative to lbs (1 lb = base) */
export const WEIGHT_CONVERSIONS: Record<WeightUnit, number> = {
  lbs: 1,
  kg: 0.453592, // 1 lb = 0.453592 kg
};

/** Display labels for units */
export const UNIT_LABELS: Record<string, string> = {
  bbl: "BBL",
  gal: "gal",
  l: "L",
  hl: "hL",
  oz: "oz",
  ml: "mL",
  lbs: "lbs",
  kg: "kg",
  f: "°F",
  c: "°C",
  plato: "°P",
  sg: "SG",
};

// =============================================================================
// Volume Conversions
// =============================================================================

/**
 * Convert volume between units.
 * @param value - The value to convert
 * @param from - Source unit
 * @param to - Target unit
 * @returns Converted value (never rounded)
 */
export function convertVolume(
  value: number,
  from: VolumeUnit,
  to: VolumeUnit
): number {
  if (from === to) return value;
  const inBbl = value / VOLUME_CONVERSIONS[from];
  return inBbl * VOLUME_CONVERSIONS[to];
}

/**
 * Format volume for display with unit label.
 * @param bbl - Value in BBL (canonical)
 * @param displayUnit - Unit to display in
 * @param decimals - Decimal places (default 2)
 */
export function formatVolume(
  bbl: number | null | undefined,
  displayUnit: VolumeUnit,
  decimals = 2
): string {
  // Audit F-132: render the em-dash for non-finite (NaN / Infinity) input so a
  // bad upstream value never reaches the screen as "NaN BBL".
  if (bbl == null || !Number.isFinite(bbl)) return "—";
  const converted = convertVolume(bbl, "bbl", displayUnit);
  return `${converted.toFixed(decimals)} ${UNIT_LABELS[displayUnit]}`;
}

/**
 * Parse user input volume to canonical BBL.
 * @param value - User input value
 * @param inputUnit - Unit of user input
 * @returns Value in BBL
 */
export function parseVolumeInput(value: number, inputUnit: VolumeUnit): number {
  return convertVolume(value, inputUnit, "bbl");
}

/**
 * Convert canonical BBL to display unit value (number only).
 */
export function volumeToDisplay(bbl: number, displayUnit: VolumeUnit): number {
  return convertVolume(bbl, "bbl", displayUnit);
}

// =============================================================================
// Retail Volume Conversions
// =============================================================================

export function convertRetailVolume(
  value: number,
  from: RetailVolumeUnit,
  to: RetailVolumeUnit
): number {
  if (from === to) return value;
  const inOz = value / RETAIL_VOLUME_CONVERSIONS[from];
  return inOz * RETAIL_VOLUME_CONVERSIONS[to];
}

export function formatRetailVolume(
  oz: number | null | undefined,
  displayUnit: RetailVolumeUnit,
  decimals = 1
): string {
  if (oz == null || !Number.isFinite(oz)) return "—";
  const converted = convertRetailVolume(oz, "oz", displayUnit);
  return `${converted.toFixed(decimals)} ${UNIT_LABELS[displayUnit]}`;
}

export function parseRetailVolumeInput(
  value: number,
  inputUnit: RetailVolumeUnit
): number {
  return convertRetailVolume(value, inputUnit, "oz");
}

// =============================================================================
// Weight Conversions
// =============================================================================

export function convertWeight(
  value: number,
  from: WeightUnit,
  to: WeightUnit
): number {
  if (from === to) return value;
  const inLbs = value / WEIGHT_CONVERSIONS[from];
  return inLbs * WEIGHT_CONVERSIONS[to];
}

export function formatWeight(
  lbs: number | null | undefined,
  displayUnit: WeightUnit,
  decimals = 2
): string {
  if (lbs == null || !Number.isFinite(lbs)) return "—";
  const converted = convertWeight(lbs, "lbs", displayUnit);
  return `${converted.toFixed(decimals)} ${UNIT_LABELS[displayUnit]}`;
}

export function parseWeightInput(value: number, inputUnit: WeightUnit): number {
  return convertWeight(value, inputUnit, "lbs");
}

export function weightToDisplay(lbs: number, displayUnit: WeightUnit): number {
  return convertWeight(lbs, "lbs", displayUnit);
}

// =============================================================================
// Temperature Conversions
// =============================================================================

export function convertTemperature(
  value: number,
  from: TemperatureUnit,
  to: TemperatureUnit
): number {
  if (from === to) return value;

  // Convert to Fahrenheit first (canonical)
  const fahrenheit = from === "c" ? (value * 9) / 5 + 32 : value;

  // Convert to target
  if (to === "c") {
    return ((fahrenheit - 32) * 5) / 9;
  }
  return fahrenheit;
}

export function formatTemperature(
  f: number | null | undefined,
  displayUnit: TemperatureUnit,
  decimals = 1
): string {
  if (f == null || !Number.isFinite(f)) return "—";
  const converted = convertTemperature(f, "f", displayUnit);
  return `${converted.toFixed(decimals)}${UNIT_LABELS[displayUnit]}`;
}

export function parseTemperatureInput(
  value: number,
  inputUnit: TemperatureUnit
): number {
  return convertTemperature(value, inputUnit, "f");
}

/** Format a temperature range (canonical °F bounds) in the user's display unit. */
export function formatTemperatureRange(
  lowF: number,
  highF: number,
  displayUnit: TemperatureUnit,
): string {
  const low = Math.round(convertTemperature(lowF, "f", displayUnit));
  const high = Math.round(convertTemperature(highF, "f", displayUnit));
  return `${low}-${high}${UNIT_LABELS[displayUnit]}`;
}

// =============================================================================
// Gravity Conversions
// =============================================================================

/**
 * Convert Plato to Specific Gravity.
 * Formula: SG = 1 + (Plato / (258.6 - 0.8796 * Plato))
 */
export function platoToSg(plato: number): number {
  return 1 + plato / (258.6 - 0.8796 * plato);
}

/**
 * Convert Specific Gravity to Plato.
 * Formula: Plato = -1 * 616.868 + 1111.14 * SG - 630.272 * SG^2 + 135.997 * SG^3
 */
export function sgToPlato(sg: number): number {
  return (
    -1 * 616.868 +
    1111.14 * sg -
    630.272 * Math.pow(sg, 2) +
    135.997 * Math.pow(sg, 3)
  );
}

export function convertGravity(
  value: number,
  from: GravityUnit,
  to: GravityUnit
): number {
  if (from === to) return value;

  if (from === "plato" && to === "sg") {
    return platoToSg(value);
  }
  return sgToPlato(value);
}

export function formatGravity(
  plato: number | null | undefined,
  displayUnit: GravityUnit,
  decimals?: number
): string {
  if (plato == null || !Number.isFinite(plato)) return "—";

  if (displayUnit === "plato") {
    return `${plato.toFixed(decimals ?? 1)}${UNIT_LABELS.plato}`;
  }
  const sg = platoToSg(plato);
  return sg.toFixed(decimals ?? 3);
}

/**
 * Format a Specific Gravity value in the user's preferred gravity unit.
 *
 * Recipe estimates and `actual_og` / `actual_fg` are stored as SG (1.0xx),
 * unlike batch readings which canonicalise to Plato. This sibling lets
 * SG-input call sites get the same unit-preference behaviour without
 * round-tripping through Plato manually.
 */
export function formatGravityFromSg(
  sg: number | null | undefined,
  displayUnit: GravityUnit,
  decimals?: number,
): string {
  if (sg == null || !Number.isFinite(sg)) return "—";
  if (displayUnit === "sg") return sg.toFixed(decimals ?? 3);
  return `${sgToPlato(sg).toFixed(decimals ?? 1)}${UNIT_LABELS.plato}`;
}

export function parseGravityInput(
  value: number,
  inputUnit: GravityUnit
): number {
  return convertGravity(value, inputUnit, "plato");
}

// =============================================================================
// Generic Helpers
// =============================================================================

/** Get available unit options for a unit type */
export function getUnitOptions(unitType: UnitType): string[] {
  switch (unitType) {
    case "volume":
      return ["bbl", "gal", "l", "hl"];
    case "retail_volume":
      return ["oz", "ml"];
    case "weight":
      return ["lbs", "kg"];
    case "temperature":
      return ["f", "c"];
    case "gravity":
      return ["plato", "sg"];
  }
}

/** Get display label for a unit */
export function getUnitLabel(unit: string): string {
  return UNIT_LABELS[unit] ?? unit;
}

/**
 * Get the next unit in the cycle for a given unit type.
 * Used by UnitDisplay click-to-cycle behavior.
 */
export function getNextUnit(unitType: UnitType, currentUnit: string): string {
  const options = getUnitOptions(unitType);
  const currentIndex = options.indexOf(currentUnit);
  return options[(currentIndex + 1) % options.length];
}

/**
 * Generic conversion from canonical to display value.
 */
export function toDisplayValue(
  canonicalValue: number,
  unitType: UnitType,
  displayUnit: string
): number {
  switch (unitType) {
    case "volume":
      return volumeToDisplay(canonicalValue, displayUnit as VolumeUnit);
    case "retail_volume":
      return convertRetailVolume(
        canonicalValue,
        "oz",
        displayUnit as RetailVolumeUnit
      );
    case "weight":
      return weightToDisplay(canonicalValue, displayUnit as WeightUnit);
    case "temperature":
      return convertTemperature(
        canonicalValue,
        "f",
        displayUnit as TemperatureUnit
      );
    case "gravity":
      return convertGravity(
        canonicalValue,
        "plato",
        displayUnit as GravityUnit
      );
  }
}

/**
 * Generic conversion from display value to canonical.
 */
export function toCanonicalValue(
  displayValue: number,
  unitType: UnitType,
  displayUnit: string
): number {
  switch (unitType) {
    case "volume":
      return parseVolumeInput(displayValue, displayUnit as VolumeUnit);
    case "retail_volume":
      return parseRetailVolumeInput(
        displayValue,
        displayUnit as RetailVolumeUnit
      );
    case "weight":
      return parseWeightInput(displayValue, displayUnit as WeightUnit);
    case "temperature":
      return parseTemperatureInput(
        displayValue,
        displayUnit as TemperatureUnit
      );
    case "gravity":
      return parseGravityInput(displayValue, displayUnit as GravityUnit);
  }
}
