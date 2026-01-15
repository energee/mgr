/**
 * Yeast Strain Entity Configuration
 *
 * Yeast strains catalog with fermentation characteristics.
 * Includes attenuation ranges, temperature preferences, flocculation, and more.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";
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
// Constants
// =============================================================================

const TYPE_OPTIONS = [
  { value: "ale", label: "Ale" },
  { value: "lager", label: "Lager" },
  { value: "wild", label: "Wild/Brett" },
  { value: "hybrid", label: "Hybrid" },
];

const FORM_OPTIONS = [
  { value: "liquid", label: "Liquid" },
  { value: "dry", label: "Dry" },
];

const FLOCCULATION_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "very_high", label: "Very High" },
];

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
      render: (value) => {
        const option = TYPE_OPTIONS.find((o) => o.value === value);
        return option?.label || String(value);
      },
    },
    {
      accessorKey: "form",
      header: "Form",
      sortable: true,
      render: (value) => {
        const option = FORM_OPTIONS.find((o) => o.value === value);
        return option?.label || String(value);
      },
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
      options: [{ value: "", label: "All Types" }, ...TYPE_OPTIONS],
    },
    {
      field: "form",
      type: "select",
      label: "Form",
      options: [{ value: "", label: "All Forms" }, ...FORM_OPTIONS],
    },
    {
      field: "manufacturer",
      type: "search",
      label: "Manufacturer",
    },
    {
      field: "is_active",
      type: "boolean",
      label: "Active Only",
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

  detailSections: [
    {
      id: "overview",
      title: "Basic Info",
      fields: [
        { field: "name", label: "Name" },
        { field: "manufacturer", label: "Manufacturer" },
        { field: "product_code", label: "Product Code" },
        { field: "type", label: "Type" },
        { field: "form", label: "Form" },
        { field: "is_active", label: "Active" },
      ],
    },
    {
      id: "fermentation",
      title: "Fermentation Characteristics",
      fields: [
        { field: "attenuation_min", label: "Attenuation Min (%)" },
        { field: "attenuation_max", label: "Attenuation Max (%)" },
        { field: "attenuation_typical", label: "Attenuation Typical (%)" },
        { field: "flocculation", label: "Flocculation" },
        { field: "alcohol_tolerance", label: "Alcohol Tolerance (%)" },
        { field: "pitching_rate", label: "Pitching Rate (M cells/mL/°P)" },
      ],
    },
    {
      id: "temperature",
      title: "Temperature Range",
      fields: [
        { field: "temp_min_f", label: "Min Temp (°F)" },
        { field: "temp_ideal_f", label: "Ideal Temp (°F)" },
        { field: "temp_max_f", label: "Max Temp (°F)" },
      ],
    },
    {
      id: "notes",
      title: "Description",
      fields: [{ field: "description", label: "Description", fullWidth: true }],
      collapsible: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: yeastStrainSchema,

  formFields: [
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
      options: TYPE_OPTIONS,
      required: true,
      colSpan: 4,
    },
    {
      name: "form",
      label: "Form",
      type: "select",
      options: FORM_OPTIONS,
      colSpan: 4,
    },
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
      name: "temp_min_f",
      label: "Min Temp (°F)",
      type: "number",
      placeholder: "e.g., 59",
      colSpan: 4,
    },
    {
      name: "temp_ideal_f",
      label: "Ideal Temp (°F)",
      type: "number",
      placeholder: "e.g., 66",
      colSpan: 4,
    },
    {
      name: "temp_max_f",
      label: "Max Temp (°F)",
      type: "number",
      placeholder: "e.g., 72",
      colSpan: 4,
    },
    {
      name: "flocculation",
      label: "Flocculation",
      type: "select",
      options: [{ value: "", label: "Not specified" }, ...FLOCCULATION_OPTIONS],
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
      label: "Pitching Rate",
      type: "number",
      placeholder: "e.g., 0.75",
      description: "Million cells per mL per °P",
      colSpan: 4,
    },
    {
      name: "description",
      label: "Description",
      type: "textarea",
      placeholder: "Flavor profile, best uses, fermentation notes...",
      colSpan: 12,
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

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "Show all yeast strains",
    "What ale yeasts do we have?",
    "Find yeasts with high attenuation",
    "List dry yeasts",
    "What yeasts work at 60°F?",
  ],

  keyFields: ["name", "manufacturer", "type", "form", "attenuation_typical", "is_active"],
};
