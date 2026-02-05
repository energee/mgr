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

import type { EntityConfig, StateMachineConfig } from "@/types/entity";
import { statesAsOptions } from "@/types/entity";
import type { Database } from "@/types/supabase";
import { MashScheduleDisplay, FermentationScheduleDisplay } from "@/components/domain/recipe-schedule-display";
import { RecipeAdditionsDisplay } from "@/components/domain/recipe-additions-display";
import { createRevisionHistoryDisplay } from "@/components/domain/revision-history-display";
import { RecipeAnalysis } from "@/components/domain/recipe-analysis";
import { StatusBadge } from "@/components/universal/status-badge";

import { recipeSchema } from "@/lib/schemas/recipe";

// Re-export schema so existing client-side imports keep working
export { recipeSchema, type RecipeFormValues } from "@/lib/schemas/recipe";

// Use table type for base fields plus any-typed view fields
// The view adds est_* fields but may not have the status field yet
type RecipeBase = Database["public"]["Tables"]["recipes"]["Row"];
type RecipeView = Database["public"]["Views"]["recipes_with_estimates"]["Row"];
type Recipe = RecipeBase & Partial<Pick<RecipeView, "est_og" | "est_fg" | "est_abv" | "est_ibu" | "est_srm" | "style_name" | "est_cogs" | "batch_count">>;

// =============================================================================
// State Machine (defined separately to derive options)
// =============================================================================

const recipeStateMachine: StateMachineConfig<Recipe> = {
  stateField: "status",
  states: ["draft", "spec", "complete"],
  initialState: "draft",
  transitions: {
    draft: ["spec", "complete"],
    spec: ["complete"],
    complete: [],
  },
  stateDisplay: {
    draft: { label: "Draft", color: "default" },
    spec: { label: "Spec", color: "warning" },
    complete: { label: "Complete", color: "success" },
  },
};

// Derive status options from state machine (single source of truth)
const statusOptions = statesAsOptions(recipeStateMachine);

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
      accessorKey: "style_name",
      header: "Style",
      sortable: true,
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
      accessorKey: "batch_count",
      header: "Batches",
      sortable: true,
      render: (value) => (value as number) || 0,
    },
    {
      accessorKey: "status",
      header: "Status",
      sortable: true,
      render: (value) => (
        <StatusBadge
          status={value as string}
          config={recipeStateMachine.stateDisplay}
        />
      ),
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
      field: "status",
      type: "multiselect",
      label: "Status",
      options: statusOptions,
    },
    {
      field: "is_active",
      type: "boolean",
      label: "Active",
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
      id: "ai-analysis",
      title: "AI Analysis",
      component: RecipeAnalysis,
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
      id: "mash_schedule",
      title: "Mash Schedule",
      component: MashScheduleDisplay,
    },
    {
      id: "fermentation_schedule",
      title: "Fermentation Schedule",
      component: FermentationScheduleDisplay,
    },
    {
      id: "additions",
      title: "Additions",
      component: RecipeAdditionsDisplay,
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
    {
      id: "revision-history",
      title: "Revision History",
      component: createRevisionHistoryDisplay("recipes"),
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
      name: "pricing_tier_id",
      label: "Pricing Tier",
      type: "select",
      placeholder: "Select pricing tier...",
      description: "Auto-suggested from COGS thresholds or set manually",
      colSpan: 6,
      dynamicOptions: {
        table: "pricing_tiers",
        valueField: "id",
        labelField: "name",
        orderBy: "cogs_max",
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
    {
      name: "status",
      label: "Recipe Status",
      type: "select",
      options: statusOptions,
      description: "Draft = incomplete, Spec = enough for planning, Complete = ready to brew",
      colSpan: 6,
    },
    // Volumes
    {
      name: "volume_bbl",
      label: "Recipe Volume",
      type: "unit",
      unitType: "volume",
      placeholder: "e.g., 7",
      colSpan: 4,
    },
    {
      name: "batch_size_bbl",
      label: "Batch Size",
      type: "unit",
      unitType: "volume",
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
      label: "Mash Temp",
      type: "unit",
      unitType: "temperature",
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
  // State Machine
  // ---------------------------------------------------------------------------
  stateMachine: recipeStateMachine,

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
  ],

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [
    {
      name: "clone",
      label: "Clone Recipe",
      icon: "copy",
      type: "button",
      // Available for all recipes - custom handler needed
    },
    {
      name: "delete",
      label: "Delete Recipe",
      icon: "trash",
      type: "dropdown",
      variant: "destructive",
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

  keyFields: ["name", "style_id", "volume_bbl", "mash_efficiency", "is_active", "status"],
};
