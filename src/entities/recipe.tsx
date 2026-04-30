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

import { WaterProfileQuickCreate } from "@/components/domain/water-profile-quick-create";
import { recipeSchema } from "@/lib/schemas/recipe";

export { recipeSchema, type RecipeFormValues } from "@/lib/schemas/recipe";

/** Base table type extended with computed view fields for list/detail display */
type RecipeBase = Database["public"]["Tables"]["recipes"]["Row"];
type RecipeView = Database["public"]["Views"]["recipes_with_estimates"]["Row"];
type Recipe = RecipeBase & Partial<Pick<RecipeView, "est_og" | "est_fg" | "est_abv" | "est_ibu" | "est_srm" | "style_name" | "est_cogs" | "batch_count">>;

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

const statusOptions = statesAsOptions(recipeStateMachine);

export const recipeEntity: EntityConfig<Recipe> = {
  name: "recipe",
  table: "recipes",
  displayName: "Recipe",
  displayNamePlural: "Recipes",
  description: "Brewing recipes with ingredients and process parameters",
  domain: "production",

  viewTable: "recipes_with_estimates",

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
      header: "Volume",
      sortable: true,
      format: "unit",
      unitType: "volume",
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
    {
      accessorKey: "created_at",
      header: "Created",
      sortable: true,
      format: "datetime",
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

  defaultSort: { column: "created_at", direction: "desc" },
  searchableFields: ["name", "brew_day_notes", "development_notes"],

  detailHeader: { title: "name" },

  sections: [
    {
      id: "overview",
      title: "Overview",
      fields: [
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
            orderBy: "manufacturer,name",
          },
        },
        {
          name: "water_profile_id",
          label: "Source Water Profile",
          type: "relation",
          relation: {
            entity: "water_profile",
            displayField: "name",
          },
          placeholder: "Select water profile...",
          quickCreate: WaterProfileQuickCreate,
          colSpan: 6,
        },
        {
          name: "target_water_profile_id",
          label: "Target Water Profile",
          type: "relation",
          relation: {
            entity: "water_profile",
            displayField: "name",
          },
          placeholder: "Select target profile...",
          description: "Target water chemistry for salt addition calculations",
          quickCreate: WaterProfileQuickCreate,
          colSpan: 6,
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
      ],
    },
    {
      id: "estimates",
      title: "Calculated Estimates",
      hideOnCreate: true,
      fields: [
        { name: "est_og", label: "Est. OG", editable: false, colSpan: 4 },
        { name: "est_fg", label: "Est. FG", editable: false, colSpan: 4 },
        { name: "est_abv", label: "Est. ABV %", editable: false, colSpan: 4 },
        { name: "est_ibu", label: "Est. IBU", editable: false, colSpan: 6 },
        { name: "est_srm", label: "Est. SRM", editable: false, colSpan: 6 },
      ],
    },
    {
      id: "ai-analysis",
      title: "AI Analysis",
      component: RecipeAnalysis,
      hideOnCreate: true,
    },
    {
      id: "volumes",
      title: "Volumes",
      hideOnCreate: true,
      fields: [
        {
          name: "volume_bbl",
          label: "Recipe Volume",
          type: "unit",
          unitType: "volume",
          format: "unit",
          placeholder: "e.g., 7",
          colSpan: 4,
        },
        {
          name: "batch_size_bbl",
          label: "Batch Size",
          type: "unit",
          unitType: "volume",
          format: "unit",
          placeholder: "e.g., 7",
          colSpan: 4,
        },
        { name: "preboil_volume_bbl", label: "Pre-Boil Volume (BBL)", editable: false, colSpan: 4 },
        { name: "target_ko_volume_bbl", label: "Target KO Volume (BBL)", editable: false, colSpan: 4 },
        { name: "mash_water_volume_gal", label: "Mash Water (gal)", editable: false, colSpan: 4 },
        { name: "sparge_water_volume_gal", label: "Sparge Water (gal)", editable: false, colSpan: 4 },
      ],
    },
    {
      id: "mash",
      title: "Mash Parameters",
      hideOnCreate: true,
      fields: [
        {
          name: "mash_temp_f",
          label: "Mash Temp",
          type: "unit",
          unitType: "temperature",
          placeholder: "e.g., 152",
          colSpan: 6,
        },
        {
          name: "target_mash_ph",
          label: "Target Mash pH",
          type: "number",
          placeholder: "e.g., 5.4",
          colSpan: 6,
        },
        {
          name: "mash_efficiency",
          label: "Mash Efficiency %",
          type: "number",
          placeholder: "e.g., 75",
          colSpan: 6,
        },
        { name: "water_to_grain_ratio", label: "Water:Grain Ratio", editable: false, colSpan: 6 },
      ],
    },
    {
      id: "boil",
      title: "Boil & Whirlpool",
      hideOnCreate: true,
      fields: [
        {
          name: "boil_time_min",
          label: "Boil Time (min)",
          type: "number",
          placeholder: "e.g., 60",
          colSpan: 6,
        },
        { name: "whirlpool_time_min", label: "Whirlpool Time (min)", editable: false, colSpan: 6 },
        { name: "whirlpool_temp_f", label: "Whirlpool Temp (°F)", editable: false, colSpan: 6 },
        { name: "target_ko_temp_f", label: "Target KO Temp (°F)", editable: false, colSpan: 6 },
      ],
    },
    {
      id: "fermentation",
      title: "Fermentation",
      hideOnCreate: true,
      fields: [
        {
          name: "target_attenuation",
          label: "Target Attenuation %",
          type: "number",
          placeholder: "e.g., 75",
          colSpan: 6,
        },
        {
          name: "target_pitching_rate",
          label: "Pitching Rate",
          type: "number",
          placeholder: "e.g., 0.75",
          description: "Million cells/mL/°P",
          colSpan: 6,
        },
        {
          name: "fermentation_days",
          label: "Fermentation Days",
          type: "number",
          placeholder: "e.g., 14",
          colSpan: 6,
        },
        {
          name: "conditioning_days",
          label: "Conditioning Days",
          type: "number",
          placeholder: "e.g., 7",
          colSpan: 6,
        },
      ],
    },
    {
      id: "mash_schedule",
      title: "Mash Schedule",
      component: MashScheduleDisplay,
      hideOnCreate: true,
    },
    {
      id: "fermentation_schedule",
      title: "Fermentation Schedule",
      component: FermentationScheduleDisplay,
      hideOnCreate: true,
    },
    {
      id: "additions",
      title: "Additions",
      component: RecipeAdditionsDisplay,
      hideOnCreate: true,
    },
    {
      id: "notes",
      title: "Notes",
      collapsible: true,
      fields: [
        {
          name: "brew_day_notes",
          label: "Brew Day Notes",
          type: "textarea",
          placeholder: "Special instructions for brew day...",
          fullWidth: true,
          colSpan: 12,
        },
        {
          name: "tasting_notes",
          label: "Tasting Notes",
          editable: false,
          fullWidth: true,
          colSpan: 12,
        },
        {
          name: "development_notes",
          label: "Development Notes",
          type: "textarea",
          placeholder: "Recipe development history, variations tried...",
          fullWidth: true,
          colSpan: 12,
        },
      ],
    },
    {
      id: "revision-history",
      title: "Revision History",
      component: createRevisionHistoryDisplay("recipes"),
      collapsible: true,
      hideOnCreate: true,
    },
  ],

  formSchema: recipeSchema,

  // ---------------------------------------------------------------------------
  // State Machine
  // ---------------------------------------------------------------------------
  stateMachine: recipeStateMachine,

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

  actions: [
    {
      name: "clone",
      label: "Clone Recipe",
      icon: "copy",
      type: "button",
    },
    {
      name: "delete",
      label: "Delete Recipe",
      icon: "trash",
      type: "dropdown",
      variant: "destructive",
      deleteMode: "hard",
      disabledWhen: (data) =>
        data.batch_count ? `Has ${data.batch_count} associated batch${data.batch_count === 1 ? "" : "es"}` : false,
    },
  ],

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
