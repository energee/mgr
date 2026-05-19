/**
 * Batch Additions Library
 *
 * Defines addition types and utilities for tracking fermentation additions
 * (dry hops, fruit, adjuncts, finings, etc.)
 */

/**
 * Type of addition made during fermentation
 */
export type AdditionType = "dry_hop" | "fruit" | "adjunct" | "fining" | "spice" | "other";

/**
 * Valid catalog table names for type-safe database queries
 */
export type CatalogTable = "hops" | "fruits" | "adjuncts" | "additives" | "spices";

type AdditionTypeConfig = {
  label: string;
  catalogTable: CatalogTable | null;  // null for "other"
  defaultUnit: string;
  showContactTime?: boolean;  // For dry hops
}

export const ADDITION_TYPES: Record<AdditionType, AdditionTypeConfig> = {
  dry_hop: {
    label: "Dry Hop",
    catalogTable: "hops",
    defaultUnit: "oz",
    showContactTime: true,
  },
  fruit: {
    label: "Fruit",
    catalogTable: "fruits",
    defaultUnit: "lb",
  },
  adjunct: {
    label: "Adjunct",
    catalogTable: "adjuncts",
    defaultUnit: "lb",
  },
  fining: {
    label: "Fining",
    catalogTable: "additives",
    defaultUnit: "g",
  },
  spice: {
    label: "Spice",
    catalogTable: "spices",
    defaultUnit: "oz",
  },
  other: {
    label: "Other",
    catalogTable: null,
    defaultUnit: "lb",
  },
};

export type BatchAddition = {
  addition_type: AdditionType;
  ingredient_id?: string;
  ingredient_name: string;
  quantity: number;
  unit: string;
  timestamp: string;
  contact_time_hours?: number;  // For dry hops
  notes?: string;
}

export const UNIT_OPTIONS = [
  { value: "oz", label: "oz" },
  { value: "lb", label: "lb" },
  { value: "g", label: "g" },
  { value: "kg", label: "kg" },
  { value: "ml", label: "mL" },
  { value: "l", label: "L" },
  { value: "each", label: "each" },
];

/**
 * Format a batch addition for display as a human-readable string
 *
 * @param addition - The batch addition to format
 * @returns A formatted string like "2 oz Cascade (Dry Hop, 72h contact)"
 * @example
 * ```ts
 * formatAddition({
 *   addition_type: "dry_hop",
 *   ingredient_name: "Cascade",
 *   quantity: 2,
 *   unit: "oz",
 *   contact_time_hours: 72
 * })
 * // Returns: "2 oz Cascade (Dry Hop, 72h contact)"
 * ```
 */
export function formatAddition(addition: BatchAddition): string {
  const { quantity, unit, ingredient_name, addition_type, contact_time_hours } =
    addition;
  const typeLabel = ADDITION_TYPES[addition_type]?.label ?? addition_type;
  const contactSuffix = contact_time_hours
    ? `, ${contact_time_hours}h contact`
    : "";
  return `${quantity} ${unit} ${ingredient_name} (${typeLabel}${contactSuffix})`;
}
