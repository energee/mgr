/**
 * Beer Style Entity Configuration
 *
 * Beer styles define BJCP style guidelines and custom brewery styles.
 * Each style has target ranges for OG, FG, ABV, IBU, and SRM.
 * BJCP styles are seeded from official guidelines; custom styles can be added.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";
import type { Database } from "@/types/supabase";

type BeerStyle = Database["public"]["Tables"]["beer_styles"]["Row"];

// =============================================================================
// Zod Schema
// =============================================================================

export const beerStyleSchema = z.object({
  name: z.string().min(1, "Name is required"),
  category: z.string().min(1, "Category is required"),
  description: z.string().nullable().optional(),
  og_min: z.coerce.number().nullable().optional(),
  og_max: z.coerce.number().nullable().optional(),
  fg_min: z.coerce.number().nullable().optional(),
  fg_max: z.coerce.number().nullable().optional(),
  abv_min: z.coerce.number().nullable().optional(),
  abv_max: z.coerce.number().nullable().optional(),
  ibu_min: z.coerce.number().nullable().optional(),
  ibu_max: z.coerce.number().nullable().optional(),
  srm_min: z.coerce.number().nullable().optional(),
  srm_max: z.coerce.number().nullable().optional(),
  is_active: z.boolean().default(true),
});

export type BeerStyleFormValues = z.infer<typeof beerStyleSchema>;

// =============================================================================
// Helper to format range
// =============================================================================

function formatRange(min: number | null, max: number | null, suffix = ""): string {
  if (min === null && max === null) return "—";
  if (min === null) return `≤${max}${suffix}`;
  if (max === null) return `≥${min}${suffix}`;
  if (min === max) return `${min}${suffix}`;
  return `${min}–${max}${suffix}`;
}

// =============================================================================
// Entity Configuration
// =============================================================================

export const beerStyleEntity: EntityConfig<BeerStyle> = {
  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------
  name: "beer_style",
  table: "beer_styles",
  displayName: "Beer Style",
  displayNamePlural: "Beer Styles",
  description: "BJCP style guidelines and custom brewery styles",
  domain: "production",

  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "name",
      header: "Style",
      sortable: true,
    },
    {
      accessorKey: "category",
      header: "Category",
      sortable: true,
    },
    {
      accessorKey: "abv_min",
      header: "ABV",
      render: (_, row) => formatRange(row.abv_min, row.abv_max, "%"),
    },
    {
      accessorKey: "ibu_min",
      header: "IBU",
      render: (_, row) => formatRange(row.ibu_min, row.ibu_max),
    },
    {
      accessorKey: "srm_min",
      header: "SRM",
      render: (_, row) => formatRange(row.srm_min, row.srm_max),
    },
    {
      accessorKey: "is_bjcp",
      header: "Source",
      render: (value) => (value ? "BJCP" : "Custom"),
    },
  ],

  listFilters: [
    {
      field: "category",
      type: "select",
      label: "Category",
      dynamicOptions: {
        table: "beer_styles",
        valueField: "category",
        labelField: "category",
        distinct: true,
      },
    },
    {
      field: "is_bjcp",
      type: "boolean",
      label: "BJCP Official",
    },
    {
      field: "is_active",
      type: "boolean",
      label: "Active",
    },
  ],

  defaultSort: { column: "category", direction: "asc" },
  searchableFields: ["name", "category", "description"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "name",
    subtitle: "category",
  },

  detailSections: [
    {
      id: "overview",
      title: "Style Information",
      fields: [
        { field: "name", label: "Style Name" },
        { field: "category", label: "Category" },
        { field: "is_bjcp", label: "BJCP Official", render: (v) => (v ? "Yes" : "No") },
        { field: "is_active", label: "Active", render: (v) => (v ? "Yes" : "No") },
      ],
    },
    {
      id: "vital-stats",
      title: "Vital Statistics",
      fields: [
        { field: "og_min", label: "OG Min" },
        { field: "og_max", label: "OG Max" },
        { field: "fg_min", label: "FG Min" },
        { field: "fg_max", label: "FG Max" },
        { field: "abv_min", label: "ABV Min (%)" },
        { field: "abv_max", label: "ABV Max (%)" },
        { field: "ibu_min", label: "IBU Min" },
        { field: "ibu_max", label: "IBU Max" },
        { field: "srm_min", label: "SRM Min" },
        { field: "srm_max", label: "SRM Max" },
      ],
    },
    {
      id: "description",
      title: "Description",
      fields: [
        { field: "description", label: "Description", fullWidth: true },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: beerStyleSchema,

  formFields: [
    {
      name: "name",
      label: "Style Name",
      type: "text",
      placeholder: "e.g., American IPA",
      required: true,
      colSpan: 6,
    },
    {
      name: "category",
      label: "Category",
      type: "text",
      placeholder: "e.g., IPA, Lager, Stout",
      required: true,
      colSpan: 6,
    },
    {
      name: "og_min",
      label: "OG Min",
      type: "number",
      placeholder: "e.g., 1.056",
      colSpan: 3,
    },
    {
      name: "og_max",
      label: "OG Max",
      type: "number",
      placeholder: "e.g., 1.070",
      colSpan: 3,
    },
    {
      name: "fg_min",
      label: "FG Min",
      type: "number",
      placeholder: "e.g., 1.008",
      colSpan: 3,
    },
    {
      name: "fg_max",
      label: "FG Max",
      type: "number",
      placeholder: "e.g., 1.014",
      colSpan: 3,
    },
    {
      name: "abv_min",
      label: "ABV Min (%)",
      type: "number",
      placeholder: "e.g., 5.5",
      colSpan: 3,
    },
    {
      name: "abv_max",
      label: "ABV Max (%)",
      type: "number",
      placeholder: "e.g., 7.5",
      colSpan: 3,
    },
    {
      name: "ibu_min",
      label: "IBU Min",
      type: "number",
      placeholder: "e.g., 40",
      colSpan: 3,
    },
    {
      name: "ibu_max",
      label: "IBU Max",
      type: "number",
      placeholder: "e.g., 70",
      colSpan: 3,
    },
    {
      name: "srm_min",
      label: "SRM Min",
      type: "number",
      placeholder: "e.g., 6",
      colSpan: 3,
    },
    {
      name: "srm_max",
      label: "SRM Max",
      type: "number",
      placeholder: "e.g., 14",
      colSpan: 3,
    },
    {
      name: "description",
      label: "Description",
      type: "textarea",
      placeholder: "Style description and characteristics",
      colSpan: 12,
    },
    {
      name: "is_active",
      label: "Active",
      type: "switch",
      description: "Inactive styles won't appear in dropdown menus",
      defaultValue: true,
      colSpan: 6,
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "List all IPA styles",
    "What are the vital stats for American Pale Ale?",
    "Show BJCP lager styles",
    "What styles have ABV over 8%?",
  ],

  keyFields: ["name", "category", "abv_min", "abv_max", "ibu_min", "ibu_max"],
};
