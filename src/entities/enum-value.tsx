/**
 * Enum Value Entity Configuration
 *
 * Centralized registry for all enum values in the system.
 * Enables dynamic enum management and AI integration.
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
  displayName: "Enum Value",
  displayNamePlural: "Enum Values",
  description: "Centralized registry for all dropdown values and statuses",
  domain: "system",

  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "enum_type",
      header: "Type",
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
      header: "Value",
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
      header: "Order",
      sortable: true,
    },
    {
      accessorKey: "is_default",
      header: "Default",
      sortable: true,
      render: (value: unknown) => (value ? "Yes" : "-"),
    },
    {
      accessorKey: "is_active",
      header: "Active",
      sortable: true,
      render: (value: unknown) => (value ? "Yes" : "No"),
    },
  ],

  listFilters: [
    {
      field: "enum_type",
      type: "select",
      label: "Type",
      // Dynamic options fetched from database - automatically includes all enum types
      fetchOptions: fetchEnumTypes,
    },
    {
      field: "is_active",
      type: "boolean",
      label: "Active",
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
      title: "Enum Value Details",
      fields: [
        { field: "enum_type", label: "Enum Type" },
        { field: "value", label: "Value" },
        { field: "label", label: "Label" },
        { field: "description", label: "Description" },
        { field: "color", label: "Color" },
        { field: "icon", label: "Icon" },
        { field: "sort_order", label: "Sort Order" },
        { field: "group_name", label: "Group" },
        { field: "is_default", label: "Is Default" },
        { field: "is_active", label: "Is Active" },
        { field: "created_at", label: "Created", format: "datetime" },
        { field: "updated_at", label: "Last Updated", format: "datetime" },
      ],
    },
    {
      id: "metadata",
      title: "Metadata",
      fields: [{ field: "metadata", label: "Metadata", format: "json" }],
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: enumValueSchema,

  formFields: [
    {
      name: "enum_type",
      label: "Enum Type",
      type: "text",
      placeholder: "e.g., batch_status, vessel_type",
      description: "The category of this enum (use snake_case)",
      required: true,
      colSpan: 6,
    },
    {
      name: "value",
      label: "Value",
      type: "text",
      placeholder: "e.g., pending, in_progress",
      description: "The value stored in the database (use snake_case)",
      required: true,
      colSpan: 6,
    },
    {
      name: "label",
      label: "Label",
      type: "text",
      placeholder: "e.g., Pending, In Progress",
      description: "Human-readable display label",
      required: true,
      colSpan: 6,
    },
    {
      name: "description",
      label: "Description",
      type: "text",
      placeholder: "Optional description",
      colSpan: 6,
    },
    {
      name: "color",
      label: "Color",
      type: "select",
      options: ENUM_COLORS as unknown as Array<{ value: string; label: string }>,
      description: "Badge color for UI display",
      colSpan: 6,
    },
    {
      name: "icon",
      label: "Icon",
      type: "text",
      placeholder: "e.g., CheckCircle, AlertTriangle",
      description: "Lucide icon name (optional)",
      colSpan: 6,
    },
    {
      name: "sort_order",
      label: "Sort Order",
      type: "number",
      description: "Lower numbers appear first",
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
      label: "Default Value",
      type: "switch",
      description: "Use this value as the default for new records",
      colSpan: 2,
    },
    {
      name: "is_active",
      label: "Active",
      type: "switch",
      description: "Inactive values won't appear in dropdowns",
      defaultValue: true,
      colSpan: 2,
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "List all batch statuses",
    "Get valid vessel types",
    "What user roles exist?",
    "Show enum values with colors",
  ],

  keyFields: ["enum_type", "value", "label", "is_active"],
};
