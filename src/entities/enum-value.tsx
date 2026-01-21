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
      options: [
        { value: "batch_status", label: "Batch Status" },
        { value: "order_status", label: "Order Status" },
        { value: "po_status", label: "PO Status" },
        { value: "vessel_status", label: "Vessel Status" },
        { value: "vessel_type", label: "Vessel Type" },
        { value: "yeast_pitch_status", label: "Yeast Pitch Status" },
        { value: "yeast_source_type", label: "Yeast Source Type" },
        { value: "yeast_type", label: "Yeast Type" },
        { value: "yeast_form", label: "Yeast Form" },
        { value: "user_role", label: "User Role" },
        { value: "user_status", label: "User Status" },
        { value: "notification_status", label: "Notification Status" },
        { value: "notification_severity", label: "Notification Severity" },
        { value: "location_type", label: "Location Type" },
        { value: "package_container_type", label: "Package Container Type" },
        { value: "keg_state", label: "Keg State" },
        { value: "keg_transaction_type", label: "Keg Transaction Type" },
        { value: "catalog_type", label: "Catalog Type" },
        { value: "volume_unit", label: "Volume Unit" },
        { value: "weight_unit", label: "Weight Unit" },
        { value: "temperature_unit", label: "Temperature Unit" },
        { value: "gravity_unit", label: "Gravity Unit" },
        { value: "fermentation_stage", label: "Fermentation Stage" },
        { value: "mash_step_type", label: "Mash Step Type" },
        { value: "packaging_session_status", label: "Packaging Session Status" },
      ],
    },
    {
      field: "is_active",
      type: "boolean",
      label: "Active Only",
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
