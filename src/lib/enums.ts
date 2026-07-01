/**
 * Enum Type Constants
 *
 * The centralized list of enum types stored in the `enum_values` table.
 * Provides type safety when querying enum values by type (see
 * `src/hooks/use-brew-enums.ts` for the current consumer).
 */

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
