/**
 * Domain-specific TypeScript types for JSON columns.
 *
 * These types replace `unknown[]` casts on JSON columns like `brew_logs.events`
 * and batch reading data, providing compile-time safety and editor autocompletion.
 *
 * Re-exports existing types from their library modules and adds any missing
 * domain types that are used across multiple components.
 */

// Re-export batch reading types from the readings library
export type { BatchReading, ReadingType } from "@/lib/batch-readings";

/**
 * A single event in a brew log's `events` JSON column.
 * Each event represents a phase of the brew day with optional measurements.
 */
export type BrewEvent = {
  /** Brew phase identifier (e.g., "mash_in", "boil_start", "ko_end") */
  phase?: string;
  /** Timestamp when this event was recorded */
  timestamp?: string;
  /** Human-readable description of the event */
  description?: string;
  /** Measurements taken during this phase */
  measurements?: BrewMeasurement[];
  /** Additional event-specific data */
  data?: Record<string, unknown>;
}

/**
 * A single measurement within a brew event.
 */
export type BrewMeasurement = {
  /** Metric identifier (e.g., "temp_f", "gravity_plato", "volume_bbl") */
  metric?: string;
  /** Measured value */
  value?: number | string;
  /** Unit of measurement */
  unit?: string;
}
