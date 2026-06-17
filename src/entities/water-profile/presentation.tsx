/**
 * Water Profile Entity — presentation
 *
 * The React/UI half of the water profile entity: list columns, list filters,
 * and the unified detail/edit sections.
 */

import type { EntityPresentation } from "@/types/entity";
import { deleteAction } from "@/types/entity";
import type { WaterProfile } from "./core";

/** Render a numeric value or em-dash for null/undefined */
const ppm = (value: unknown): string => (value != null ? `${value}` : "—");

/** Mineral field definitions reused across sections */
const mineralFields = [
  { name: "calcium_ppm", label: "Ca²⁺", type: "number", placeholder: "0", colSpan: 2 },
  { name: "magnesium_ppm", label: "Mg²⁺", type: "number", placeholder: "0", colSpan: 2 },
  { name: "sodium_ppm", label: "Na⁺", type: "number", placeholder: "0", colSpan: 2 },
  { name: "sulfate_ppm", label: "SO₄²⁻", type: "number", placeholder: "0", colSpan: 2 },
  { name: "chloride_ppm", label: "Cl⁻", type: "number", placeholder: "0", colSpan: 1 },
  { name: "bicarbonate_ppm", label: "HCO₃⁻", type: "number", placeholder: "0", colSpan: 2 },
  { name: "ph", label: "pH", type: "number", placeholder: "7.0", colSpan: 1 },
] as const;

export const waterProfilePresentation: EntityPresentation<WaterProfile> = {
  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    { accessorKey: "name", header: "Name", sortable: true },
    { accessorKey: "calcium_ppm", header: "Ca²⁺", sortable: true, render: ppm },
    { accessorKey: "magnesium_ppm", header: "Mg²⁺", sortable: true, render: ppm },
    { accessorKey: "sodium_ppm", header: "Na⁺", sortable: true, render: ppm },
    { accessorKey: "sulfate_ppm", header: "SO₄²⁻", sortable: true, render: ppm },
    { accessorKey: "chloride_ppm", header: "Cl⁻", sortable: true, render: ppm },
    { accessorKey: "bicarbonate_ppm", header: "HCO₃⁻", sortable: true, render: ppm },
    { accessorKey: "ph", header: "pH", sortable: true, render: ppm },
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

  // ---------------------------------------------------------------------------
  // Unified Sections (detail + edit)
  // ---------------------------------------------------------------------------
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
      fields: [...mineralFields],
    },
  ],

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [deleteAction("Profile")],
};
