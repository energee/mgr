/**
 * Beer Style Entity — presentation
 *
 * The React/UI half of the beer style entity: list columns, list filters,
 * and the unified detail/edit sections.
 */

import type { EntityPresentation } from "@/types/entity";
import { deleteAction } from "@/types/entity";
import type { BeerStyle } from "./core";

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

export const beerStylePresentation: EntityPresentation<BeerStyle> = {
  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "name",
      header: "Style",
    },
    {
      accessorKey: "category",
      header: "Category",
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

  // ---------------------------------------------------------------------------
  // Unified Sections (detail + edit)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Style Information",
      fields: [
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
          name: "is_bjcp",
          label: "BJCP Official",
          render: (v) => (v ? "Yes" : "No"),
          editable: false,
          colSpan: 6,
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
    },
    {
      id: "vital-stats",
      title: "Vital Statistics",
      fields: [
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
      ],
    },
    {
      id: "description",
      title: "Description",
      fields: [
        {
          name: "description",
          label: "Description",
          type: "textarea",
          placeholder: "Style description and characteristics",
          fullWidth: true,
        },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [deleteAction("Beer Style")],
};
