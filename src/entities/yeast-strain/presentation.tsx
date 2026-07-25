/**
 * Yeast Strain Entity — presentation
 *
 * The React/UI half of the yeast strain entity: list columns, list filters,
 * unified detail/edit sections, and actions.
 */

import type { EntityPresentation } from "@/types/entity";
import { deleteAction, getValueLabel } from "@/types/entity";
import {
  yeastStrainCore,
  typeOptions,
  formOptions,
  flocculationOptions,
} from "./core";
import type { Yeast } from "./core";

export const yeastStrainPresentation: EntityPresentation<Yeast> = {
  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "name",
      header: "Name",
    },
    {
      accessorKey: "manufacturer",
      header: "Manufacturer",
      render: (value) => (value ? String(value) : "—"),
    },
    {
      accessorKey: "product_code",
      header: "Code",
      render: (value) => (value ? String(value) : "—"),
    },
    {
      accessorKey: "type",
      header: "Type",
      render: (value) => getValueLabel(yeastStrainCore, "type", value as string),
    },
    {
      accessorKey: "form",
      header: "Form",
      render: (value) => getValueLabel(yeastStrainCore, "form", value as string),
    },
    {
      accessorKey: "attenuation_typical",
      header: "Attenuation",
      render: (value) => (value != null ? `${value}%` : "—"),
    },
    {
      accessorKey: "is_active",
      header: "Active",
      render: (value) => (value ? "Yes" : "No"),
    },
  ],

  listFilters: [
    {
      field: "type",
      type: "select",
      label: "Type",
      options: typeOptions,
    },
    {
      field: "form",
      type: "select",
      label: "Form",
      options: formOptions,
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
          options: typeOptions,
          required: true,
          colSpan: 4,
        },
        {
          name: "form",
          label: "Form",
          type: "select",
          options: formOptions,
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
          options: [{ value: "_none", label: "Not specified" }, ...flocculationOptions],
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
  // Actions
  // ---------------------------------------------------------------------------
  actions: [deleteAction("Yeast Strain")],
};

