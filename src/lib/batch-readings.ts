/**
 * Batch Readings Library
 *
 * Defines reading types, validation ranges, and utility functions
 * for fermentation metrics (gravity, temp, pH, pressure, DO, diacetyl, clarity).
 */

export type ReadingType =
  | "gravity"
  | "temperature"
  | "ph"
  | "pressure"
  | "dissolved_oxygen"
  | "diacetyl"
  | "clarity";

interface ReadingTypeConfig {
  label: string;
  units: string[];
  defaultUnit: string;
  min?: number;
  max?: number;
  step?: number;
  warningRanges?: { low: number; high: number };
  options?: string[]; // For non-numeric types like diacetyl
}

export const READING_TYPES: Record<ReadingType, ReadingTypeConfig> = {
  gravity: {
    label: "Gravity",
    units: ["sg", "plato"],
    defaultUnit: "plato",
    min: 0,
    max: 40, // Plato
    step: 0.1,
    warningRanges: { low: 0, high: 25 },
  },
  temperature: {
    label: "Temperature",
    units: ["f", "c"],
    defaultUnit: "f",
    min: 32,
    max: 100, // °F
    step: 0.5,
    warningRanges: { low: 55, high: 85 }, // Fermentation range
  },
  ph: {
    label: "pH",
    units: ["ph"],
    defaultUnit: "ph",
    min: 0,
    max: 14,
    step: 0.01,
    warningRanges: { low: 3.5, high: 5.0 },
  },
  pressure: {
    label: "Pressure",
    units: ["psi"],
    defaultUnit: "psi",
    min: 0,
    max: 50,
    step: 0.5,
    warningRanges: { low: 0, high: 30 },
  },
  dissolved_oxygen: {
    label: "Dissolved Oxygen",
    units: ["ppb"],
    defaultUnit: "ppb",
    min: 0,
    max: 1000,
    step: 1,
    warningRanges: { low: 0, high: 50 },
  },
  diacetyl: {
    label: "Diacetyl",
    units: ["status"],
    defaultUnit: "status",
    options: ["absent", "trace", "present"],
  },
  clarity: {
    label: "Clarity",
    units: ["scale", "ntu"],
    defaultUnit: "scale",
    min: 1,
    max: 5,
    step: 1,
  },
};

export interface BatchReading {
  reading_type: ReadingType;
  value: number | string;
  unit: string;
  timestamp: string;
  notes?: string;
}

export interface ValidationResult {
  valid: boolean;
  warning?: string;
}

/**
 * Validate a reading value against its type's constraints
 */
export function validateReading(
  type: ReadingType,
  value: number | string
): ValidationResult {
  const config = READING_TYPES[type];
  if (!config) {
    return { valid: false, warning: "Unknown reading type" };
  }

  // Handle option-based readings (like diacetyl)
  if (config.options) {
    const isValid = config.options.includes(String(value));
    return {
      valid: isValid,
      warning: isValid ? undefined : `Invalid option. Must be one of: ${config.options.join(", ")}`,
    };
  }

  // Handle numeric readings
  const numValue = typeof value === "string" ? parseFloat(value) : value;

  if (isNaN(numValue)) {
    return { valid: false, warning: "Value must be a number" };
  }

  if (config.min !== undefined && numValue < config.min) {
    return {
      valid: false,
      warning: `Value must be at least ${config.min}`,
    };
  }

  if (config.max !== undefined && numValue > config.max) {
    return {
      valid: false,
      warning: `Value must be at most ${config.max}`,
    };
  }

  // Check warning ranges (valid but unusual)
  if (config.warningRanges) {
    if (numValue < config.warningRanges.low || numValue > config.warningRanges.high) {
      return {
        valid: true,
        warning: `Value outside typical range (${config.warningRanges.low}-${config.warningRanges.high})`,
      };
    }
  }

  return { valid: true };
}

/**
 * Convert gravity between SG and Plato
 */
export function convertGravity(value: number, from: "sg" | "plato", to: "sg" | "plato"): number {
  if (from === to) return value;

  if (from === "sg" && to === "plato") {
    // SG to Plato: Plato = 259 - (259 / SG)
    return 259 - 259 / value;
  }

  // Plato to SG: SG = 259 / (259 - Plato)
  return 259 / (259 - value);
}

/**
 * Convert temperature between F and C
 */
export function convertTemperature(value: number, from: "f" | "c", to: "f" | "c"): number {
  if (from === to) return value;

  if (from === "f" && to === "c") {
    return (value - 32) * (5 / 9);
  }

  return value * (9 / 5) + 32;
}

/**
 * Format a reading value for display
 */
export function formatReadingValue(
  type: ReadingType,
  value: number | string,
  unit: string
): string {
  const config = READING_TYPES[type];

  if (config.options) {
    return String(value).charAt(0).toUpperCase() + String(value).slice(1);
  }

  const numValue = typeof value === "string" ? parseFloat(value) : value;

  // Format based on type
  switch (type) {
    case "gravity":
      return unit === "sg" ? numValue.toFixed(3) : numValue.toFixed(1);
    case "temperature":
      return `${numValue.toFixed(1)}°${unit.toUpperCase()}`;
    case "ph":
      return numValue.toFixed(2);
    case "pressure":
      return `${numValue.toFixed(1)} PSI`;
    case "dissolved_oxygen":
      return `${numValue.toFixed(0)} ppb`;
    case "clarity":
      return unit === "ntu" ? `${numValue.toFixed(1)} NTU` : `${numValue}/5`;
    default:
      return String(value);
  }
}

/**
 * Get unit label for display
 */
export function getUnitLabel(type: ReadingType, unit: string): string {
  switch (type) {
    case "gravity":
      return unit === "sg" ? "SG" : "°P";
    case "temperature":
      return unit === "f" ? "°F" : "°C";
    case "ph":
      return "pH";
    case "pressure":
      return "PSI";
    case "dissolved_oxygen":
      return "ppb";
    case "clarity":
      return unit === "ntu" ? "NTU" : "1-5 Scale";
    case "diacetyl":
      return "";
    default:
      return unit;
  }
}
