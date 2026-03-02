/**
 * Status & Option Entity Configuration
 *
 * Manages the values that appear in dropdowns and status fields
 * throughout the app (e.g., batch statuses, vessel types, user roles).
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";
import type { Database } from "@/types/supabase";
import { StatusBadge } from "@/components/universal/status-badge";
import { createClient } from "@/lib/supabase/client";

type EnumValue = Database["public"]["Tables"]["enum_values"]["Row"];

// =============================================================================
// Zod Schema
// =============================================================================

export const enumValueSchema = z.object({
  enum_type: z.string().min(1, "Enum type is required"),
  value: z.string().min(1, "Value is required"),
  label: z.string().min(1, "Label is required"),
  description: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  icon: z.string().optional().nullable(),
  sort_order: z.number().int().default(0),
  group_name: z.string().optional().nullable(),
  is_default: z.boolean().default(false),
  is_active: z.boolean().default(true),
  metadata: z.any().optional().nullable(),
});

export type EnumValueFormValues = z.infer<typeof enumValueSchema>;

// =============================================================================
// Color Options (matches StatusBadge)
// =============================================================================

export const ENUM_COLORS = [
  { value: "default", label: "Default (Gray)" },
  { value: "success", label: "Success (Green)" },
  { value: "warning", label: "Warning (Yellow)" },
  { value: "error", label: "Error (Red)" },
  { value: "info", label: "Info (Blue)" },
] as const;

// =============================================================================
// Dynamic Options Fetcher
// =============================================================================

/**
 * Fetches all distinct enum types from the database.
 * Used for dynamic filter options in EntityList.
 */
export async function fetchEnumTypes(): Promise<{ value: string; label: string }[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("enum_values")
    .select("enum_type")
    .order("enum_type");

  if (error) {
    console.error("Failed to fetch enum types:", error);
    return [];
  }

  // Get unique enum_types and format them
  const uniqueTypes = [...new Set(data?.map((d) => d.enum_type) || [])];
  return uniqueTypes.map((type) => ({
    value: type,
    label: type
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" "),
  }));
}

// =============================================================================
// Entity Configuration
// =============================================================================

export const enumValueEntity: EntityConfig<EnumValue> = {
  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------
  name: "enum_value",
  table: "enum_values",
  displayName: "Status & Option",
  displayNamePlural: "Status & Options",
  description: "Values that appear in dropdowns and status fields throughout the app",
  domain: "system",

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

  defaultSort: { column: "enum_type", direction: "asc" },
  searchableFields: ["enum_type", "value", "label", "description"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "label",
    subtitle: "enum_type",
  },

  detailSections: [
    {
      id: "overview",
      title: "Option Details",
      fields: [
        { field: "enum_type", label: "Category" },
        { field: "value", label: "Stored Value" },
        { field: "label", label: "Display Label" },
        { field: "description", label: "Description" },
        { field: "color", label: "Color" },
        { field: "icon", label: "Icon" },
        { field: "sort_order", label: "Sort Order" },
        { field: "group_name", label: "Group" },
        { field: "is_default", label: "Default?" },
        { field: "is_active", label: "Enabled" },
        { field: "created_at", label: "Created", format: "datetime" },
        { field: "updated_at", label: "Last Updated", format: "datetime" },
      ],
    },
    {
      id: "metadata",
      title: "Extra Data",
      fields: [{ field: "metadata", label: "Extra Data", format: "json" }],
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
  // Form
  // ---------------------------------------------------------------------------
  formSchema: enumValueSchema,

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [
    {
      name: "delete",
      label: "Delete Enum Value",
      icon: "trash",
      type: "dropdown",
      variant: "destructive",
      deleteMode: "hard",
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "List all batch statuses",
    "Get valid vessel types",
    "What user roles exist?",
    "Show dropdown options with colors",
  ],

  keyFields: ["enum_type", "value", "label", "is_active"],
};
