/**
 * Yeast Strain Entity Configuration
 *
 * Yeast strains catalog with fermentation characteristics.
 * Includes attenuation ranges, temperature preferences, flocculation, and more.
 */

import { z } from "zod";
import type { EntityConfig, ValueDisplayConfig } from "@/types/entity";
import { valuesAsOptions, getValueLabel } from "@/types/entity";
import type { Database } from "@/types/supabase";

type Yeast = Database["public"]["Tables"]["yeasts"]["Row"];

// =============================================================================
// Zod Schema
// =============================================================================

export const yeastStrainSchema = z.object({
  name: z.string().min(1, "Name is required"),
  manufacturer: z.string().nullable().optional(),
  product_code: z.string().nullable().optional(),
  type: z.enum(["ale", "lager", "wild", "hybrid"]).default("ale"),
  form: z.enum(["dry", "liquid"]).default("liquid"),
  attenuation_min: z.coerce.number().min(0).max(100).nullable().optional(),
  attenuation_max: z.coerce.number().min(0).max(100).nullable().optional(),
  attenuation_typical: z.coerce.number().min(0).max(100).nullable().optional(),
  temp_min_f: z.coerce.number().int().nullable().optional(),
  temp_max_f: z.coerce.number().int().nullable().optional(),
  temp_ideal_f: z.coerce.number().int().nullable().optional(),
  flocculation: z.enum(["low", "medium", "high", "very_high"]).nullable().optional(),
  alcohol_tolerance: z.coerce.number().min(0).max(25).nullable().optional(),
  pitching_rate: z.coerce.number().min(0).max(5).default(0.75).nullable().optional(),
  description: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
});

export type YeastStrainFormValues = z.infer<typeof yeastStrainSchema>;

// =============================================================================
// Value Display Configurations
// =============================================================================

const typeDisplayConfig: ValueDisplayConfig = {
  field: "type",
  display: {
    ale: { label: "Ale" },
    lager: { label: "Lager" },
    wild: { label: "Wild/Brett" },
    hybrid: { label: "Hybrid" },
  },
};

const formDisplayConfig: ValueDisplayConfig = {
  field: "form",
  display: {
    liquid: { label: "Liquid" },
    dry: { label: "Dry" },
  },
};

const flocculationDisplayConfig: ValueDisplayConfig = {
  field: "flocculation",
  display: {
    low: { label: "Low" },
    medium: { label: "Medium" },
    high: { label: "High" },
    very_high: { label: "Very High" },
  },
};

// =============================================================================
// Entity Configuration
// =============================================================================

export const yeastStrainEntity: EntityConfig<Yeast> = {
  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------
  name: "yeast_strain",
  table: "yeasts",
  displayName: "Yeast Strain",
  displayNamePlural: "Yeast Strains",
  description: "Yeast strains catalog with fermentation characteristics",
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
      accessorKey: "manufacturer",
      header: "Manufacturer",
      sortable: true,
      render: (value) => (value ? String(value) : "—"),
    },
    {
      accessorKey: "product_code",
      header: "Code",
      sortable: true,
      render: (value) => (value ? String(value) : "—"),
    },
    {
      accessorKey: "type",
      header: "Type",
      sortable: true,
      render: (value) => getValueLabel(yeastStrainEntity, "type", value as string),
    },
    {
      accessorKey: "form",
      header: "Form",
      sortable: true,
      render: (value) => getValueLabel(yeastStrainEntity, "form", value as string),
    },
    {
      accessorKey: "attenuation_typical",
      header: "Attenuation",
      sortable: true,
      render: (value) => (value != null ? `${value}%` : "—"),
    },
    {
      accessorKey: "is_active",
      header: "Active",
      sortable: true,
      render: (value) => (value ? "Yes" : "No"),
    },
  ],

  listFilters: [
    {
      field: "type",
      type: "select",
      label: "Type",
      options: valuesAsOptions(typeDisplayConfig),
    },
    {
      field: "form",
      type: "select",
      label: "Form",
      options: valuesAsOptions(formDisplayConfig),
    },
    {
      field: "manufacturer",
      type: "search",
      label: "Manufacturer",
    },
    {
      field: "is_active",
      type: "boolean",
      label: "Active",
    },
  ],

  defaultSort: { column: "name", direction: "asc" },
  searchableFields: ["name", "manufacturer", "product_code", "description"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "name",
    subtitle: "manufacturer",
  },

  // ---------------------------------------------------------------------------
  // Unified Sections (detail + edit)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Basic Info",
      fields: [
        {
          name: "name",
          label: "Name",
          type: "text",
          placeholder: "e.g., Safale US-05, WLP001",
          required: true,
          colSpan: 6,
        },
        {
          name: "manufacturer",
          label: "Manufacturer",
          type: "text",
          placeholder: "e.g., Fermentis, White Labs, Wyeast",
          colSpan: 6,
        },
        {
          name: "product_code",
          label: "Product Code",
          type: "text",
          placeholder: "e.g., US-05, WLP001, 1056",
          colSpan: 4,
        },
        {
          name: "type",
          label: "Type",
          type: "select",
          options: valuesAsOptions(typeDisplayConfig),
          required: true,
          colSpan: 4,
        },
        {
          name: "form",
          label: "Form",
          type: "select",
          options: valuesAsOptions(formDisplayConfig),
          colSpan: 4,
        },
        {
          name: "is_active",
          label: "Active",
          type: "switch",
          description: "Inactive strains won't appear in dropdown menus",
          defaultValue: true,
          colSpan: 12,
        },
      ],
    },
    {
      id: "fermentation",
      title: "Fermentation Characteristics",
      fields: [
        {
          name: "attenuation_min",
          label: "Attenuation Min (%)",
          type: "number",
          placeholder: "e.g., 73",
          description: "Minimum expected attenuation",
          colSpan: 4,
        },
        {
          name: "attenuation_typical",
          label: "Attenuation Typical (%)",
          type: "number",
          placeholder: "e.g., 77",
          description: "Typical attenuation under normal conditions",
          colSpan: 4,
        },
        {
          name: "attenuation_max",
          label: "Attenuation Max (%)",
          type: "number",
          placeholder: "e.g., 81",
          description: "Maximum expected attenuation",
          colSpan: 4,
        },
        {
          name: "flocculation",
          label: "Flocculation",
          type: "select",
          options: [{ value: "_none", label: "Not specified" }, ...valuesAsOptions(flocculationDisplayConfig)],
          colSpan: 4,
        },
        {
          name: "alcohol_tolerance",
          label: "Alcohol Tolerance (%)",
          type: "number",
          placeholder: "e.g., 12",
          description: "Maximum ABV tolerance",
          colSpan: 4,
        },
        {
          name: "pitching_rate",
          label: "Pitching Rate (M cells/mL/°P)",
          type: "number",
          placeholder: "e.g., 0.75",
          description: "Million cells per mL per °P",
          colSpan: 4,
        },
      ],
    },
    {
      id: "temperature",
      title: "Temperature Range",
      fields: [
        {
          name: "temp_min_f",
          label: "Min Temp",
          type: "unit",
          unitType: "temperature",
          format: "unit",
          placeholder: "e.g., 59",
          colSpan: 4,
        },
        {
          name: "temp_ideal_f",
          label: "Ideal Temp",
          type: "unit",
          unitType: "temperature",
          format: "unit",
          placeholder: "e.g., 66",
          colSpan: 4,
        },
        {
          name: "temp_max_f",
          label: "Max Temp",
          type: "unit",
          unitType: "temperature",
          format: "unit",
          placeholder: "e.g., 72",
          colSpan: 4,
        },
      ],
    },
    {
      id: "notes",
      title: "Description",
      collapsible: true,
      fields: [
        {
          name: "description",
          label: "Description",
          type: "textarea",
          placeholder: "Flavor profile, best uses, fermentation notes...",
          fullWidth: true,
        },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: yeastStrainSchema,

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [
    {
      name: "delete",
      label: "Delete Yeast Strain",
      icon: "trash",
      type: "dropdown",
      variant: "destructive",
      deleteMode: "hard",
    },
  ],

  // ---------------------------------------------------------------------------
  // Value Display
  // ---------------------------------------------------------------------------
  valueDisplay: [typeDisplayConfig, formDisplayConfig, flocculationDisplayConfig],
};
