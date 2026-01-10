/**
 * Recipe Entity Configuration
 *
 * Recipes define the specifications for brewing - ingredients,
 * process parameters, and target measurements.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";
import type { Database } from "@/types/supabase";

type Recipe = Database["public"]["Tables"]["recipes"]["Row"];

// =============================================================================
// Zod Schema
// =============================================================================

export const recipeSchema = z.object({
  name: z.string().min(1, "Name is required"),
  style: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  target_og: z.coerce.number().nullable().optional(),
  target_fg: z.coerce.number().nullable().optional(),
  target_abv: z.coerce.number().nullable().optional(),
  target_ibu: z.coerce.number().int().nullable().optional(),
  target_srm: z.coerce.number().int().nullable().optional(),
  batch_size_gallons: z.coerce.number().nullable().optional(),
  boil_time_minutes: z.coerce.number().int().nullable().optional(),
  mash_temp_f: z.coerce.number().int().nullable().optional(),
  notes: z.string().nullable().optional(),
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
  description: "Recipes with ingredients and brewing parameters",
  domain: "production",

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
      accessorKey: "style",
      header: "Style",
      sortable: true,
    },
    {
      accessorKey: "target_abv",
      header: "ABV %",
      sortable: true,
      render: (value) => value ? `${value}%` : "—",
    },
    {
      accessorKey: "target_ibu",
      header: "IBU",
      sortable: true,
    },
    {
      accessorKey: "batch_size_gallons",
      header: "Batch Size (gal)",
      sortable: true,
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
      field: "style",
      type: "search",
      label: "Style",
    },
  ],

  defaultSort: { column: "name", direction: "asc" },
  searchableFields: ["name", "style", "description"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "name",
    subtitle: "style",
  },

  detailSections: [
    {
      id: "overview",
      title: "Overview",
      fields: [
        { field: "name", label: "Name" },
        { field: "style", label: "Style" },
        { field: "description", label: "Description", fullWidth: true },
        { field: "is_active", label: "Active" },
      ],
    },
    {
      id: "targets",
      title: "Target Specifications",
      fields: [
        { field: "target_og", label: "Original Gravity" },
        { field: "target_fg", label: "Final Gravity" },
        { field: "target_abv", label: "ABV %" },
        { field: "target_ibu", label: "IBU" },
        { field: "target_srm", label: "SRM (Color)" },
      ],
    },
    {
      id: "process",
      title: "Process Parameters",
      fields: [
        { field: "batch_size_gallons", label: "Batch Size (gallons)" },
        { field: "boil_time_minutes", label: "Boil Time (minutes)" },
        { field: "mash_temp_f", label: "Mash Temperature (°F)" },
      ],
    },
    {
      id: "notes",
      title: "Notes",
      fields: [
        { field: "notes", label: "Notes", fullWidth: true },
      ],
      collapsible: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: recipeSchema,

  formFields: [
    {
      name: "name",
      label: "Recipe Name",
      type: "text",
      placeholder: "e.g., Hazy Days IPA",
      required: true,
      colSpan: 6,
    },
    {
      name: "style",
      label: "Style",
      type: "text",
      placeholder: "e.g., New England IPA",
      colSpan: 6,
    },
    {
      name: "description",
      label: "Description",
      type: "textarea",
      placeholder: "Brief description of this recipe...",
      colSpan: 12,
    },
    {
      name: "target_og",
      label: "Target OG",
      type: "number",
      placeholder: "e.g., 1.065",
      description: "Original gravity target",
      colSpan: 4,
    },
    {
      name: "target_fg",
      label: "Target FG",
      type: "number",
      placeholder: "e.g., 1.012",
      description: "Final gravity target",
      colSpan: 4,
    },
    {
      name: "target_abv",
      label: "Target ABV %",
      type: "number",
      placeholder: "e.g., 6.8",
      colSpan: 4,
    },
    {
      name: "target_ibu",
      label: "Target IBU",
      type: "number",
      placeholder: "e.g., 45",
      description: "Bitterness units",
      colSpan: 4,
    },
    {
      name: "target_srm",
      label: "Target SRM",
      type: "number",
      placeholder: "e.g., 5",
      description: "Color (Standard Reference Method)",
      colSpan: 4,
    },
    {
      name: "batch_size_gallons",
      label: "Batch Size (gallons)",
      type: "number",
      placeholder: "e.g., 10",
      colSpan: 4,
    },
    {
      name: "boil_time_minutes",
      label: "Boil Time (minutes)",
      type: "number",
      placeholder: "e.g., 60",
      colSpan: 4,
    },
    {
      name: "mash_temp_f",
      label: "Mash Temp (°F)",
      type: "number",
      placeholder: "e.g., 152",
      colSpan: 4,
    },
    {
      name: "is_active",
      label: "Active",
      type: "switch",
      description: "Inactive recipes won't appear in dropdown menus",
      defaultValue: true,
      colSpan: 4,
    },
    {
      name: "notes",
      label: "Brewing Notes",
      type: "textarea",
      placeholder: "Additional notes, tips, variations...",
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
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "Show me all IPA recipes",
    "What recipes have ABV over 7%?",
    "List active recipes sorted by style",
    "Find recipes with IBU over 50",
  ],

  keyFields: ["name", "style", "target_abv", "target_ibu", "is_active"],
};
