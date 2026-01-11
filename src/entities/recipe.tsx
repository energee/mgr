/**
 * Recipe Entity Configuration
 *
 * Recipes define the specifications for brewing - ingredients,
 * process parameters, and target measurements.
 *
 * Ingredients are stored in junction tables (recipe_malts, recipe_hops, etc.)
 * and calculated estimates (OG, FG, ABV, IBU, SRM) come from the
 * recipes_with_estimates view.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";
import type { Database } from "@/types/supabase";

// Use view type to include calculated estimates
type Recipe = Database["public"]["Views"]["recipes_with_estimates"]["Row"];

// =============================================================================
// Zod Schema
// =============================================================================

export const recipeSchema = z.object({
  name: z.string().min(1, "Name is required"),
  brand_id: z.string().uuid().nullable().optional(),
  style_id: z.string().uuid().nullable().optional(),
  yeast_id: z.string().uuid().nullable().optional(),
  water_profile_id: z.string().uuid().nullable().optional(),
  description: z.string().nullable().optional(),
  // Volumes
  volume_bbl: z.coerce.number().nullable().optional(),
  batch_size_bbl: z.coerce.number().nullable().optional(),
  preboil_volume_bbl: z.coerce.number().nullable().optional(),
  target_ko_volume_bbl: z.coerce.number().nullable().optional(),
  mash_water_volume_gal: z.coerce.number().nullable().optional(),
  sparge_water_volume_gal: z.coerce.number().nullable().optional(),
  // Times
  boil_time_min: z.coerce.number().int().nullable().optional(),
  fermentation_days: z.coerce.number().int().nullable().optional(),
  conditioning_days: z.coerce.number().int().nullable().optional(),
  // Whirlpool
  whirlpool_time_min: z.coerce.number().int().nullable().optional(),
  whirlpool_temp_f: z.coerce.number().int().nullable().optional(),
  // Mash
  mash_temp_f: z.coerce.number().int().nullable().optional(),
  target_mash_ph: z.coerce.number().nullable().optional(),
  mash_efficiency: z.coerce.number().nullable().optional(),
  // Yeast
  target_attenuation: z.coerce.number().nullable().optional(),
  target_pitching_rate: z.coerce.number().nullable().optional(),
  // Notes
  brew_day_notes: z.string().nullable().optional(),
  tasting_notes: z.string().nullable().optional(),
  development_notes: z.string().nullable().optional(),
  // Flags
  use_default_additions: z.boolean().default(true),
  is_active: z.boolean().default(true),
});

export type RecipeFormValues = z.infer<typeof recipeSchema>;

// =============================================================================
// Entity Configuration
// =============================================================================

export const recipeEntity: EntityConfig<Recipe> = {
  name: "recipe",
  table: "recipes",
  displayName: "Recipe",
  displayNamePlural: "Recipes",
  description: "Brewing recipes with ingredients and process parameters",
  domain: "production",

  // Use the view for calculated estimates in list/detail views
  // Forms write to base table, reads use this view
  viewTable: "recipes_with_estimates",

  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "name",
      header: "Name",
      sortable: true,
    },
    {
      accessorKey: "style_id",
      header: "Style",
      sortable: true,
      // Note: view needs to be updated to join beer_styles for style_name
      // For now, this shows the UUID. Future migration will add style_name.
      render: (value) => value ? "—" : "—",
    },
    {
      accessorKey: "volume_bbl",
      header: "Volume (BBL)",
      sortable: true,
    },
    {
      accessorKey: "mash_efficiency",
      header: "Efficiency %",
      sortable: true,
      render: (value) => value ? `${value}%` : "—",
    },
    {
      accessorKey: "boil_time_min",
      header: "Boil Time",
      sortable: true,
      render: (value) => value ? `${value} min` : "—",
    },
    {
      accessorKey: "is_active",
      header: "Active",
      sortable: true,
      render: (value) => value ? "Yes" : "No",
    },
  ],

  listFilters: [
    {
      field: "is_active",
      type: "boolean",
      label: "Active Only",
    },
    {
      field: "style_id",
      type: "select",
      label: "Style",
      dynamicOptions: {
        table: "beer_styles",
        valueField: "id",
        labelField: "name",
        orderBy: "category,name",
      },
    },
  ],

  defaultSort: { column: "name", direction: "asc" },
  searchableFields: ["name", "brew_day_notes", "development_notes"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "name",
    // badge: "is_active",
  },

  detailSections: [
    {
      id: "overview",
      title: "Overview",
      fields: [
        { field: "name", label: "Name" },
        { field: "brand_id", label: "Brand" },
        { field: "style_id", label: "Style" },
        { field: "yeast_id", label: "Yeast" },
        { field: "water_profile_id", label: "Water Profile" },
        { field: "is_active", label: "Active" },
      ],
    },
    {
      id: "estimates",
      title: "Calculated Estimates",
      fields: [
        // These come from recipes_with_estimates view
        { field: "est_og", label: "Est. OG" },
        { field: "est_fg", label: "Est. FG" },
        { field: "est_abv", label: "Est. ABV %" },
        { field: "est_ibu", label: "Est. IBU" },
        { field: "est_srm", label: "Est. SRM" },
      ],
    },
    {
      id: "volumes",
      title: "Volumes",
      fields: [
        { field: "volume_bbl", label: "Recipe Volume (BBL)" },
        { field: "batch_size_bbl", label: "Batch Size (BBL)" },
        { field: "preboil_volume_bbl", label: "Pre-Boil Volume (BBL)" },
        { field: "target_ko_volume_bbl", label: "Target KO Volume (BBL)" },
        { field: "mash_water_volume_gal", label: "Mash Water (gal)" },
        { field: "sparge_water_volume_gal", label: "Sparge Water (gal)" },
      ],
    },
    {
      id: "mash",
      title: "Mash Parameters",
      fields: [
        { field: "mash_temp_f", label: "Mash Temp (°F)" },
        { field: "target_mash_ph", label: "Target Mash pH" },
        { field: "mash_efficiency", label: "Mash Efficiency %" },
        { field: "water_to_grain_ratio", label: "Water:Grain Ratio" },
      ],
    },
    {
      id: "boil",
      title: "Boil & Whirlpool",
      fields: [
        { field: "boil_time_min", label: "Boil Time (min)" },
        { field: "whirlpool_time_min", label: "Whirlpool Time (min)" },
        { field: "whirlpool_temp_f", label: "Whirlpool Temp (°F)" },
        { field: "target_ko_temp_f", label: "Target KO Temp (°F)" },
      ],
    },
    {
      id: "fermentation",
      title: "Fermentation",
      fields: [
        { field: "target_attenuation", label: "Target Attenuation %" },
        { field: "target_pitching_rate", label: "Pitching Rate (M cells/mL/°P)" },
        { field: "fermentation_days", label: "Fermentation Days" },
        { field: "conditioning_days", label: "Conditioning Days" },
      ],
    },
    {
      id: "notes",
      title: "Notes",
      fields: [
        { field: "brew_day_notes", label: "Brew Day Notes", fullWidth: true },
        { field: "tasting_notes", label: "Tasting Notes", fullWidth: true },
        { field: "development_notes", label: "Development Notes", fullWidth: true },
      ],
      collapsible: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: recipeSchema,

  formFields: [
    // Basic Info
    {
      name: "name",
      label: "Recipe Name",
      type: "text",
      placeholder: "e.g., Hazy Days IPA",
      required: true,
      colSpan: 6,
    },
    {
      name: "brand_id",
      label: "Brand",
      type: "select",
      placeholder: "Select brand...",
      colSpan: 6,
      dynamicOptions: {
        table: "brands",
        valueField: "id",
        labelField: "name",
        orderBy: "name",
      },
    },
    {
      name: "style_id",
      label: "Style",
      type: "select",
      placeholder: "Select style...",
      colSpan: 6,
      dynamicOptions: {
        table: "beer_styles",
        valueField: "id",
        labelField: "name",
        orderBy: "category,name",
      },
    },
    {
      name: "yeast_id",
      label: "Yeast",
      type: "select",
      placeholder: "Select yeast...",
      colSpan: 6,
      dynamicOptions: {
        table: "yeasts",
        valueField: "id",
        labelField: "name",
        orderBy: "lab,name",
      },
    },
    {
      name: "water_profile_id",
      label: "Water Profile",
      type: "select",
      placeholder: "Select water profile...",
      colSpan: 6,
      dynamicOptions: {
        table: "water_profiles",
        valueField: "id",
        labelField: "name",
        orderBy: "name",
      },
    },
    {
      name: "is_active",
      label: "Active",
      type: "switch",
      description: "Inactive recipes won't appear in dropdown menus",
      defaultValue: true,
      colSpan: 6,
    },
    // Volumes
    {
      name: "volume_bbl",
      label: "Recipe Volume (BBL)",
      type: "number",
      placeholder: "e.g., 7",
      colSpan: 4,
    },
    {
      name: "batch_size_bbl",
      label: "Batch Size (BBL)",
      type: "number",
      placeholder: "e.g., 7",
      colSpan: 4,
    },
    {
      name: "mash_efficiency",
      label: "Mash Efficiency %",
      type: "number",
      placeholder: "e.g., 75",
      colSpan: 4,
    },
    // Process
    {
      name: "boil_time_min",
      label: "Boil Time (min)",
      type: "number",
      placeholder: "e.g., 60",
      colSpan: 3,
    },
    {
      name: "mash_temp_f",
      label: "Mash Temp (°F)",
      type: "number",
      placeholder: "e.g., 152",
      colSpan: 3,
    },
    {
      name: "target_mash_ph",
      label: "Target Mash pH",
      type: "number",
      placeholder: "e.g., 5.4",
      colSpan: 3,
    },
    {
      name: "target_attenuation",
      label: "Target Attenuation %",
      type: "number",
      placeholder: "e.g., 75",
      colSpan: 3,
    },
    // Fermentation
    {
      name: "fermentation_days",
      label: "Fermentation Days",
      type: "number",
      placeholder: "e.g., 14",
      colSpan: 3,
    },
    {
      name: "conditioning_days",
      label: "Conditioning Days",
      type: "number",
      placeholder: "e.g., 7",
      colSpan: 3,
    },
    {
      name: "target_pitching_rate",
      label: "Pitching Rate",
      type: "number",
      placeholder: "e.g., 0.75",
      description: "Million cells/mL/°P",
      colSpan: 3,
    },
    {
      name: "use_default_additions",
      label: "Use Default Water Additions",
      type: "switch",
      defaultValue: true,
      colSpan: 3,
    },
    // Notes
    {
      name: "brew_day_notes",
      label: "Brew Day Notes",
      type: "textarea",
      placeholder: "Special instructions for brew day...",
      colSpan: 12,
    },
    {
      name: "development_notes",
      label: "Development Notes",
      type: "textarea",
      placeholder: "Recipe development history, variations tried...",
      colSpan: 12,
    },
  ],

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
  relations: [
    {
      name: "batches",
      entity: "batch",
      type: "hasMany",
      foreignKey: "recipe_id",
      showInDetail: true,
      detailTab: "Batches",
    },
    {
      name: "malts",
      entity: "recipe_malt",
      type: "hasMany",
      foreignKey: "recipe_id",
      showInDetail: true,
      detailTab: "Grain Bill",
    },
    {
      name: "hops",
      entity: "recipe_hop",
      type: "hasMany",
      foreignKey: "recipe_id",
      showInDetail: true,
      detailTab: "Hop Schedule",
    },
    {
      name: "style",
      entity: "beer_style",
      type: "belongsTo",
      foreignKey: "style_id",
    },
    {
      name: "yeast",
      entity: "yeast",
      type: "belongsTo",
      foreignKey: "yeast_id",
    },
    {
      name: "water_profile",
      entity: "water_profile",
      type: "belongsTo",
      foreignKey: "water_profile_id",
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "Show me all IPA recipes",
    "What recipes have estimated ABV over 7%?",
    "List active recipes sorted by style",
    "Find recipes with estimated IBU over 50",
    "What recipes use Citra hops?",
    "Show grain bill for recipe X",
  ],

  keyFields: ["name", "style_id", "volume_bbl", "mash_efficiency", "is_active"],
};
