/**
 * Enum Utilities
 *
 * Type-safe utilities for working with the centralized enum registry.
 * Fetches enum values from the database and provides helper functions
 * for validation, display, and state machine transitions.
 */

import { createClient } from "@/lib/supabase/client";
import type { Json } from "@/types/supabase";
import { log } from "@/lib/client-logger";

// =============================================================================
// Types
// =============================================================================

export interface EnumValue {
  value: string;
  label: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  sort_order: number;
  is_default: boolean | null;
  metadata: Json;
}

export interface EnumMetadata {
  next_states?: string[];
  permissions?: string[];
  temp_range_f?: [number, number];
  to_liters?: number;
  to_kg?: number;
  viability_decay_per_day?: number;
  typical_uses?: string[];
  affects_inventory?: boolean;
  [key: string]: unknown;
}

export type EnumColor = "default" | "success" | "warning" | "error" | "info";

// =============================================================================
// Enum Type Constants
// =============================================================================

/**
 * Known enum types in the system.
 * This provides type safety when fetching enum values.
 */
export const ENUM_TYPES = {
  // State machines
  BATCH_STATUS: "batch_status",
  ORDER_STATUS: "order_status",
  PO_STATUS: "po_status",
  VESSEL_STATUS: "vessel_status",
  YEAST_PITCH_STATUS: "yeast_pitch_status",
  PACKAGING_SESSION_STATUS: "packaging_session_status",
  KEG_STATE: "keg_state",
  NOTIFICATION_STATUS: "notification_status",

  // Brew day
  BREW_PHASE: "brew_phase",
  BREW_METRIC: "brew_metric",

  // Classifications
  VESSEL_TYPE: "vessel_type",
  YEAST_TYPE: "yeast_type",
  YEAST_FORM: "yeast_form",
  YEAST_SOURCE_TYPE: "yeast_source_type",
  LOCATION_TYPE: "location_type",
  CATALOG_TYPE: "catalog_type",
  KEG_TRANSACTION_TYPE: "keg_transaction_type",
  MASH_STEP_TYPE: "mash_step_type",
  FERMENTATION_STAGE: "fermentation_stage",

  // User management
  USER_ROLE: "user_role",
  USER_STATUS: "user_status",
  NOTIFICATION_SEVERITY: "notification_severity",

  // Units
  VOLUME_UNIT: "volume_unit",
  WEIGHT_UNIT: "weight_unit",
  TEMPERATURE_UNIT: "temperature_unit",
  GRAVITY_UNIT: "gravity_unit",
} as const;

export type EnumType = (typeof ENUM_TYPES)[keyof typeof ENUM_TYPES];

// =============================================================================
// Fetch Functions
// =============================================================================

/**
 * Fetches all values for a specific enum type.
 *
 * @example
 * const statuses = await getEnumValues('batch_status');
 * // [{ value: 'planned', label: 'Planned', ... }, ...]
 */
export async function getEnumValues(
  enumType: EnumType | string,
  activeOnly = true
): Promise<EnumValue[]> {
  const supabase = createClient();
  let query = supabase
    .from("enum_values")
    .select("value, label, description, color, icon, sort_order, is_default, metadata")
    .eq("enum_type", enumType)
    .order("sort_order");

  if (activeOnly) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query;

  if (error) {
    log.error(`Failed to fetch enum values for ${enumType}:`, error);
    return [];
  }

  return data || [];
}

/**
 * Fetches all enum types and their values.
 *
 * @example
 * const allEnums = await getAllEnums();
 * // { batch_status: [...], order_status: [...], ... }
 */
export async function getAllEnums(): Promise<Record<string, EnumValue[]>> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("enum_values")
    .select("enum_type, value, label, description, color, icon, sort_order, is_default, metadata")
    .eq("is_active", true)
    .order("enum_type")
    .order("sort_order");

  if (error) {
    log.error("Failed to fetch all enums:", error);
    return {};
  }

  // Group by enum_type
  return (data || []).reduce(
    (acc, row) => {
      const { enum_type, ...rest } = row;
      if (!acc[enum_type]) {
        acc[enum_type] = [];
      }
      acc[enum_type].push(rest as EnumValue);
      return acc;
    },
    {} as Record<string, EnumValue[]>
  );
}

/**
 * Gets a single enum value by type and value.
 *
 * @example
 * const status = await getEnumValue('batch_status', 'fermenting');
 * // { value: 'fermenting', label: 'Fermenting', color: 'info', ... }
 */
export async function getEnumValue(
  enumType: EnumType | string,
  value: string
): Promise<EnumValue | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("enum_values")
    .select("value, label, description, color, icon, sort_order, is_default, metadata")
    .eq("enum_type", enumType)
    .eq("value", value)
    .single();

  if (error) {
    log.error(`Failed to fetch enum value ${enumType}.${value}:`, error);
    return null;
  }

  return data;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Gets the default value for an enum type.
 *
 * @example
 * const defaultStatus = await getEnumDefault('batch_status');
 * // 'planned'
 */
export async function getEnumDefault(enumType: EnumType | string): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("enum_values")
    .select("value")
    .eq("enum_type", enumType)
    .eq("is_default", true)
    .eq("is_active", true)
    .single();

  if (error) {
    log.error(`Failed to fetch default for ${enumType}:`, error);
    return null;
  }

  return data?.value || null;
}

/**
 * Gets the display label for an enum value.
 *
 * @example
 * const label = await getEnumLabel('batch_status', 'fermenting');
 * // 'Fermenting'
 */
export async function getEnumLabel(
  enumType: EnumType | string,
  value: string
): Promise<string> {
  const enumValue = await getEnumValue(enumType, value);
  return enumValue?.label || value;
}

/**
 * Converts enum values to select options format.
 *
 * @example
 * const options = await getEnumOptions('batch_status');
 * // [{ value: 'planned', label: 'Planned' }, ...]
 */
export async function getEnumOptions(
  enumType: EnumType | string
): Promise<{ value: string; label: string }[]> {
  const values = await getEnumValues(enumType);
  return values.map((v) => ({ value: v.value, label: v.label }));
}

/**
 * Validates if a value is valid for an enum type.
 *
 * @example
 * const isValid = await isValidEnumValue('batch_status', 'fermenting');
 * // true
 */
export async function isValidEnumValue(
  enumType: EnumType | string,
  value: string
): Promise<boolean> {
  const supabase = createClient();
  const { data } = await supabase
    .from("enum_values")
    .select("value")
    .eq("enum_type", enumType)
    .eq("value", value)
    .eq("is_active", true)
    .single();

  return !!data;
}

// =============================================================================
// State Machine Helpers
// =============================================================================

/**
 * Gets the valid next states for a state machine enum.
 *
 * @example
 * const nextStates = await getNextStates('batch_status', 'fermenting');
 * // ['conditioning', 'cancelled']
 */
export async function getNextStates(
  enumType: EnumType | string,
  currentValue: string
): Promise<string[]> {
  const enumValue = await getEnumValue(enumType, currentValue);
  const metadata = enumValue?.metadata as EnumMetadata | null;
  return metadata?.next_states || [];
}

/**
 * Checks if a state transition is valid.
 *
 * @example
 * const canTransition = await canTransitionTo('batch_status', 'fermenting', 'conditioning');
 * // true
 */
export async function canTransitionTo(
  enumType: EnumType | string,
  fromValue: string,
  toValue: string
): Promise<boolean> {
  const nextStates = await getNextStates(enumType, fromValue);
  return nextStates.includes(toValue);
}

/**
 * Gets the full state machine for an enum type.
 * Returns a map of state -> next states.
 *
 * @example
 * const machine = await getStateMachine('batch_status');
 * // { planned: ['fermenting', 'cancelled'], fermenting: ['conditioning', 'cancelled'], ... }
 */
export async function getStateMachine(
  enumType: EnumType | string
): Promise<Record<string, string[]>> {
  const values = await getEnumValues(enumType);
  return values.reduce(
    (acc, v) => {
      const metadata = v.metadata as EnumMetadata | null;
      acc[v.value] = metadata?.next_states || [];
      return acc;
    },
    {} as Record<string, string[]>
  );
}

// =============================================================================
// Unit Conversion Helpers
// =============================================================================

/**
 * Gets unit conversion metadata.
 *
 * @example
 * const conversionFactor = await getUnitConversion('volume_unit', 'bbl');
 * // { to_liters: 117.347765 }
 */
export async function getUnitConversion(
  unitType: "volume_unit" | "weight_unit",
  value: string
): Promise<EnumMetadata | null> {
  const enumValue = await getEnumValue(unitType, value);
  return enumValue?.metadata as EnumMetadata | null;
}

// =============================================================================
// Display Helpers
// =============================================================================

/**
 * Gets the color for an enum value (for StatusBadge).
 *
 * @example
 * const color = await getEnumColor('batch_status', 'fermenting');
 * // 'info'
 */
export async function getEnumColor(
  enumType: EnumType | string,
  value: string
): Promise<EnumColor> {
  const enumValue = await getEnumValue(enumType, value);
  return (enumValue?.color as EnumColor) || "default";
}

/**
 * Gets all values for display with their colors.
 * Useful for rendering status badges or building status selectors.
 *
 * @example
 * const displayValues = await getEnumDisplayValues('batch_status');
 * // [{ value: 'planned', label: 'Planned', color: 'default' }, ...]
 */
export async function getEnumDisplayValues(
  enumType: EnumType | string
): Promise<Array<{ value: string; label: string; color: EnumColor }>> {
  const values = await getEnumValues(enumType);
  return values.map((v) => ({
    value: v.value,
    label: v.label,
    color: (v.color as EnumColor) || "default",
  }));
}
