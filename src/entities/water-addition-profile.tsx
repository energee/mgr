/**
 * Water Addition Profile Entity Configuration
 *
 * Named profiles of water salt/acid additions that can be shared across recipes.
 * Each profile contains a set of additive items (stored in recipe_additions
 * via profile_id). Managed under Settings > Catalogs.
 */

import type { EntityConfig } from "@/types/entity";
import type { Database } from "@/types/supabase";
import { waterAdditionProfileSchema } from "@/lib/schemas/water-addition-profile";
import { ProfileAdditionsEditor } from "@/components/domain/profile-additions-editor";

type WaterAdditionProfile = Database["public"]["Tables"]["water_addition_profiles"]["Row"];

export { waterAdditionProfileSchema };
export type { WaterAdditionProfileFormValues } from "@/lib/schemas/water-addition-profile";

export const waterAdditionProfileEntity: EntityConfig<WaterAdditionProfile> = {
  name: "water_addition_profile",
  table: "water_addition_profiles",
  displayName: "Water Addition Profile",
  displayNamePlural: "Water Addition Profiles",
  description: "Named profiles of water salt/acid additions shared across recipes",
  domain: "system",

  // List View
  listColumns: [
    {
      accessorKey: "name",
      header: "Name",
      sortable: true,
    },
    {
      accessorKey: "description",
      header: "Description",
      sortable: false,
      render: (value) => (value ? String(value) : "—"),
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
      field: "is_active",
      type: "boolean",
      label: "Active",
    },
  ],

  defaultSort: { column: "name", direction: "asc" },
  searchableFields: ["name", "description"],

  // Detail View
  detailHeader: { title: "name" },

  // Unified Sections (detail + edit)
  sections: [
    {
      id: "overview",
      title: "Overview",
      fields: [
        {
          name: "name",
          label: "Name",
          type: "text",
          placeholder: "e.g., Standard Lager Salts",
          required: true,
          colSpan: 6,
        },
        {
          name: "is_active",
          label: "Active",
          type: "switch",
          description: "Inactive profiles won't appear in recipe dropdowns",
          defaultValue: true,
          colSpan: 6,
        },
        {
          name: "description",
          label: "Description",
          type: "textarea",
          placeholder: "Describe the target water chemistry or use case...",
          colSpan: 12,
        },
      ],
    },
    {
      id: "targets",
      title: "Water Chemistry Targets",
      fields: [
        {
          name: "water_profile_id",
          label: "Source Water Profile",
          type: "relation",
          relation: {
            entity: "water_profile",
            displayField: "name",
          },
          colSpan: 12,
          description: "Baseline water chemistry for auto-calculation",
        },
        { name: "target_calcium_ppm", label: "Ca\u00B2\u207A", type: "number", placeholder: "0", colSpan: 2 },
        { name: "target_magnesium_ppm", label: "Mg\u00B2\u207A", type: "number", placeholder: "0", colSpan: 2 },
        { name: "target_sodium_ppm", label: "Na\u207A", type: "number", placeholder: "0", colSpan: 2 },
        { name: "target_sulfate_ppm", label: "SO\u2084\u00B2\u207B", type: "number", placeholder: "0", colSpan: 2 },
        { name: "target_chloride_ppm", label: "Cl\u207B", type: "number", placeholder: "0", colSpan: 1 },
        { name: "target_bicarbonate_ppm", label: "HCO\u2083\u207B", type: "number", placeholder: "0", colSpan: 2 },
        { name: "target_ph", label: "pH", type: "number", placeholder: "7.0", colSpan: 1 },
      ],
    },
    {
      id: "additions",
      title: "Additions",
      component: ProfileAdditionsEditor,
    },
  ],

  // Form
  formSchema: waterAdditionProfileSchema,

  formFields: [
    {
      name: "name",
      label: "Name",
      type: "text",
      placeholder: "e.g., Standard Lager Salts",
      required: true,
      colSpan: 6,
    },
    {
      name: "is_active",
      label: "Active",
      type: "switch",
      description: "Inactive profiles won't appear in recipe dropdowns",
      defaultValue: true,
      colSpan: 6,
    },
    {
      name: "description",
      label: "Description",
      type: "textarea",
      placeholder: "Describe the target water chemistry or use case...",
      colSpan: 12,
    },
    {
      name: "water_profile_id",
      label: "Source Water Profile",
      type: "relation",
      relation: {
        entity: "water_profile",
        displayField: "name",
      },
      colSpan: 12,
    },
    { name: "target_calcium_ppm", label: "Ca\u00B2\u207A", type: "number", placeholder: "0", colSpan: 2 },
    { name: "target_magnesium_ppm", label: "Mg\u00B2\u207A", type: "number", placeholder: "0", colSpan: 2 },
    { name: "target_sodium_ppm", label: "Na\u207A", type: "number", placeholder: "0", colSpan: 2 },
    { name: "target_sulfate_ppm", label: "SO\u2084\u00B2\u207B", type: "number", placeholder: "0", colSpan: 2 },
    { name: "target_chloride_ppm", label: "Cl\u207B", type: "number", placeholder: "0", colSpan: 1 },
    { name: "target_bicarbonate_ppm", label: "HCO\u2083\u207B", type: "number", placeholder: "0", colSpan: 2 },
    { name: "target_ph", label: "pH", type: "number", placeholder: "7.0", colSpan: 1 },
  ],

  // Actions
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

  // AI Context
  queryExamples: [
    "Show all water addition profiles",
    "What profiles are active?",
    "Find the IPA water profile",
  ],

  keyFields: ["name", "is_active"],
};
