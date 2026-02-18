/**
 * Water Profile Entity Configuration
 *
 * Source water chemistry profiles (e.g., "City Tap Water", "RO Water").
 * Stores mineral content in ppm. Managed under Settings domain.
 * Recipes link to a water profile via water_profile_id FK.
 */

import type { EntityConfig } from "@/types/entity";
import { waterProfileSchema } from "@/lib/schemas/water-profile";
import type { Database } from "@/types/supabase";

type WaterProfile = Database["public"]["Tables"]["water_profiles"]["Row"];

export { waterProfileSchema };
export type { WaterProfileFormValues } from "@/lib/schemas/water-profile";

export const waterProfileEntity: EntityConfig<WaterProfile> = {
  name: "water_profile",
  table: "water_profiles",
  displayName: "Water Profile",
  displayNamePlural: "Water Profiles",
  description: "Source water chemistry profiles with mineral content",
  domain: "system",

  // List View
  listColumns: [
    { accessorKey: "name", header: "Name", sortable: true },
    {
      accessorKey: "calcium_ppm",
      header: "Ca²⁺",
      sortable: true,
      render: (value) => (value != null ? `${value}` : "—"),
    },
    {
      accessorKey: "sulfate_ppm",
      header: "SO₄²⁻",
      sortable: true,
      render: (value) => (value != null ? `${value}` : "—"),
    },
    {
      accessorKey: "chloride_ppm",
      header: "Cl⁻",
      sortable: true,
      render: (value) => (value != null ? `${value}` : "—"),
    },
    {
      accessorKey: "ph",
      header: "pH",
      sortable: true,
      render: (value) => (value != null ? `${value}` : "—"),
    },
    {
      accessorKey: "is_active",
      header: "Active",
      sortable: true,
      render: (value) => (value ? "Yes" : "No"),
    },
  ],

  listFilters: [
    { field: "is_active", type: "boolean", label: "Active" },
  ],

  defaultSort: { column: "name", direction: "asc" },
  searchableFields: ["name", "description"],

  // Detail View
  detailHeader: { title: "name" },

  sections: [
    {
      id: "overview",
      title: "Profile Info",
      fields: [
        {
          name: "name",
          label: "Name",
          type: "text",
          placeholder: "e.g., City Tap Water",
          required: true,
          colSpan: 6,
        },
        {
          name: "is_active",
          label: "Active",
          type: "switch",
          description: "Inactive profiles hidden from recipe dropdowns",
          defaultValue: true,
          colSpan: 6,
        },
        {
          name: "description",
          label: "Description",
          type: "textarea",
          placeholder: "Describe this water source...",
          fullWidth: true,
          colSpan: 12,
        },
      ],
    },
    {
      id: "minerals",
      title: "Mineral Content (ppm)",
      fields: [
        {
          name: "calcium_ppm",
          label: "Calcium (Ca²⁺)",
          type: "number",
          placeholder: "0",
          colSpan: 4,
        },
        {
          name: "magnesium_ppm",
          label: "Magnesium (Mg²⁺)",
          type: "number",
          placeholder: "0",
          colSpan: 4,
        },
        {
          name: "sodium_ppm",
          label: "Sodium (Na⁺)",
          type: "number",
          placeholder: "0",
          colSpan: 4,
        },
        {
          name: "sulfate_ppm",
          label: "Sulfate (SO₄²⁻)",
          type: "number",
          placeholder: "0",
          colSpan: 4,
        },
        {
          name: "chloride_ppm",
          label: "Chloride (Cl⁻)",
          type: "number",
          placeholder: "0",
          colSpan: 4,
        },
        {
          name: "bicarbonate_ppm",
          label: "Bicarbonate (HCO₃⁻)",
          type: "number",
          placeholder: "0",
          colSpan: 4,
        },
        {
          name: "ph",
          label: "pH",
          type: "number",
          placeholder: "7.0",
          colSpan: 4,
        },
      ],
    },
  ],

  formSchema: waterProfileSchema,

  formFields: [
    {
      name: "name",
      label: "Name",
      type: "text",
      placeholder: "e.g., City Tap Water",
      required: true,
      colSpan: 6,
    },
    {
      name: "is_active",
      label: "Active",
      type: "switch",
      description: "Inactive profiles hidden from recipe dropdowns",
      defaultValue: true,
      colSpan: 6,
    },
    {
      name: "description",
      label: "Description",
      type: "textarea",
      placeholder: "Describe this water source...",
      colSpan: 12,
    },
    { name: "calcium_ppm", label: "Calcium (Ca²⁺)", type: "number", placeholder: "0", colSpan: 4 },
    { name: "magnesium_ppm", label: "Magnesium (Mg²⁺)", type: "number", placeholder: "0", colSpan: 4 },
    { name: "sodium_ppm", label: "Sodium (Na⁺)", type: "number", placeholder: "0", colSpan: 4 },
    { name: "sulfate_ppm", label: "Sulfate (SO₄²⁻)", type: "number", placeholder: "0", colSpan: 4 },
    { name: "chloride_ppm", label: "Chloride (Cl⁻)", type: "number", placeholder: "0", colSpan: 4 },
    { name: "bicarbonate_ppm", label: "Bicarbonate (HCO₃⁻)", type: "number", placeholder: "0", colSpan: 4 },
    { name: "ph", label: "pH", type: "number", placeholder: "7.0", colSpan: 4 },
  ],

  actions: [
    {
      name: "delete",
      label: "Delete Profile",
      icon: "trash",
      type: "dropdown",
      variant: "destructive",
      deleteMode: "hard",
    },
  ],

  keyFields: ["name", "is_active"],
  queryExamples: [
    "Show all water profiles",
    "What is the mineral content of our tap water?",
    "Which water profiles have high sulfate?",
  ],
};
