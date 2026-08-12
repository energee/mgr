/**
 * Shared label/color lookups and the row type for recipe_additions display
 * components (recipe-additions-display.tsx, additions-table.tsx,
 * other-additions-section.tsx).
 *
 * These are brewing-process/additive-type constants, not entity status —
 * no stateMachine applies (DEC-007 covers status colors only), and sibling
 * displays (recipe-schedule-display, batch additions-editor) keep such
 * lookups at the component layer too, so they live here rather than in the
 * recipe entity config.
 */

/** Water chemistry additive types */
export const WATER_CHEMISTRY_TYPES = ["water_salt", "acid"];

/** Domain constants: brewing process timing labels (not entity status -- no stateMachine applies). */
export const TIMING_LABELS: Record<string, string> = {
  mash: "Mash",
  sparge: "Sparge",
  boil: "Boil",
  whirlpool: "Whirlpool",
  fermentation: "Fermentation",
  packaging: "Packaging",
};

/** Domain constants: water chemistry target labels (not entity status). */
export const TARGET_LABELS: Record<string, string> = {
  mash: "Mash Water",
  sparge: "Sparge Water",
  kettle: "Kettle",
};

/** Domain constants: additive type labels (not entity status -- no stateMachine applies). */
export const TYPE_LABELS: Record<string, string> = {
  water_salt: "Water Salt",
  acid: "Acid",
  clarifier: "Clarifier",
  nutrient: "Nutrient",
  antifoam: "Antifoam",
  other: "Other",
};

/** Domain constants: additive type badge colors (not entity status). */
export const TYPE_COLORS: Record<string, string> = {
  water_salt: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  acid: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  clarifier: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  nutrient: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  antifoam: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  other: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
};

/** A recipe_additions row with its nested additive, as fetched for display */
export type AdditionRow = {
  id: string;
  additive_id: string;
  amount: number;
  unit: string;
  timing: string;
  target: string | null;
  position: number | null;
  additive: {
    id: string;
    name: string;
    type: string;
    description: string | null;
  } | null;
}
