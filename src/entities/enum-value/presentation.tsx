/**
 * Enum Value Entity — presentation
 *
 * The React/UI half of the enum value entity: list columns, list filters, and
 * the unified detail/edit sections.
 */

import type { EntityPresentation } from "@/types/entity";
import { deleteAction } from "@/types/entity";
import { StatusBadge } from "@/components/universal/status-badge";
import { ENUM_COLORS, fetchEnumTypes } from "./core";
import type { EnumValue } from "./core";

export const enumValuePresentation: EntityPresentation<EnumValue> = {
  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "enum_type",
      header: "Category",
      sortable: true,
      render: (value: unknown) => {
        // Convert snake_case to Title Case
        const str = String(value);
        return str
          .split("_")
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" ");
      },
    },
    {
      accessorKey: "value",
      header: "Stored Value",
      sortable: true,
    },
    {
      accessorKey: "label",
      header: "Label",
      sortable: true,
    },
    {
      accessorKey: "color",
      header: "Color",
      sortable: false,
      render: (value: unknown, row: Record<string, unknown>) => {
        if (!value) return "-";
        const color = value as "default" | "success" | "warning" | "error" | "info";
        return <StatusBadge status={row.label as string} variant={color} />;
      },
    },
    {
      accessorKey: "sort_order",
      header: "Sort Order",
      sortable: true,
    },
    {
      accessorKey: "is_default",
      header: "Default?",
      sortable: true,
      render: (value: unknown) => (value ? "Yes" : "-"),
    },
    {
      accessorKey: "is_active",
      header: "Enabled",
      sortable: true,
      render: (value: unknown) => (value ? "Yes" : "No"),
    },
  ],

  listFilters: [
    {
      field: "enum_type",
      type: "select",
      label: "Category",
      fetchOptions: fetchEnumTypes,
    },
    {
      field: "is_active",
      type: "boolean",
      label: "Enabled",
    },
  ],

  // ---------------------------------------------------------------------------
  // Unified Sections (detail + edit)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Option Details",
      fields: [
        {
          name: "enum_type",
          label: "Category",
          type: "text",
          placeholder: "e.g., batch_status, vessel_type",
          description: "Which dropdown or status field this option belongs to",
          required: true,
          colSpan: 6,
        },
        {
          name: "value",
          label: "Stored Value",
          type: "text",
          placeholder: "e.g., pending, in_progress",
          description: "The value saved when this option is selected (use lowercase with underscores)",
          required: true,
          colSpan: 6,
        },
        {
          name: "label",
          label: "Display Label",
          type: "text",
          placeholder: "e.g., Pending, In Progress",
          description: "What users see in the dropdown",
          required: true,
          colSpan: 6,
        },
        {
          name: "description",
          label: "Description",
          type: "text",
          placeholder: "Optional description of when to use this option",
          colSpan: 6,
        },
        {
          name: "color",
          label: "Color",
          type: "select",
          options: ENUM_COLORS as unknown as Array<{ value: string; label: string }>,
          description: "Color shown on status badges",
          colSpan: 6,
        },
        {
          name: "icon",
          label: "Icon",
          type: "text",
          placeholder: "e.g., CheckCircle, AlertTriangle",
          description: "Icon name (optional)",
          colSpan: 6,
        },
        {
          name: "sort_order",
          label: "Sort Order",
          type: "number",
          description: "Lower numbers appear first in dropdowns",
          defaultValue: 0,
          colSpan: 4,
        },
        {
          name: "group_name",
          label: "Group",
          type: "text",
          placeholder: "Optional grouping",
          colSpan: 4,
        },
        {
          name: "is_default",
          label: "Pre-selected",
          type: "switch",
          description: "Automatically selected for new records",
          colSpan: 2,
        },
        {
          name: "is_active",
          label: "Enabled",
          type: "switch",
          description: "Disabled options are hidden from dropdowns",
          defaultValue: true,
          colSpan: 2,
        },
        {
          name: "created_at",
          label: "Created",
          format: "datetime",
          editable: false,
          colSpan: 6,
        },
        {
          name: "updated_at",
          label: "Last Updated",
          format: "datetime",
          editable: false,
          colSpan: 6,
        },
      ],
    },
    {
      id: "metadata",
      title: "Extra Data",
      fields: [
        {
          name: "metadata",
          label: "Extra Data",
          format: "json",
          editable: false,
          fullWidth: true,
        },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [deleteAction("Enum Value")],
};
