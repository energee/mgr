/**
 * Batch Additions Library
 *
 * Defines addition types and utilities for tracking fermentation additions
 * (dry hops, fruit, adjuncts, finings, etc.)
 */

export type AdditionType = "dry_hop" | "fruit" | "adjunct" | "fining" | "spice" | "other";

/** Valid catalog table names for type-safe queries */
export type CatalogTable = "hops" | "fruits" | "adjuncts" | "additives" | "spices";

interface AdditionTypeConfig {
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

export interface BatchAddition {
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
 * Format the addition for display
 */
export function formatAddition(addition: BatchAddition): string {
  const quantity = `${addition.quantity} ${addition.unit}`;
  const name = addition.ingredient_name;
  const type = ADDITION_TYPES[addition.addition_type]?.label || addition.addition_type;

  if (addition.contact_time_hours) {
    return `${quantity} ${name} (${type}, ${addition.contact_time_hours}h contact)`;
  }

  return `${quantity} ${name} (${type})`;
}
