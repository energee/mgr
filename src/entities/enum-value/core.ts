/**
 * Enum Value Entity — server-safe core
 *
 * The pure-data half of the enum value entity: identity, the zod form schema,
 * and AI metadata. No React imports — safe to import from server route handlers
 * and API routes.
 *
 * Manages the values that appear in dropdowns and status fields throughout the
 * app (e.g., batch statuses, vessel types, user roles).
 */

import { z } from "zod";
import type { EntityCoreInput } from "@/types/entity";
import type { Database } from "@/types/supabase";
import { createClient } from "@/lib/supabase/client";
import { log } from "@/lib/client-logger";

export type EnumValue = Database["public"]["Tables"]["enum_values"]["Row"];

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
    log.error("Failed to fetch enum types:", error);
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
// Entity Core
// =============================================================================

export const enumValueCore: EntityCoreInput<EnumValue> = {
  name: "enum_value",
  table: "enum_values",
  displayName: "Status & Option",
  description: "Values that appear in dropdowns and status fields throughout the app",
  domain: "system",
  basePath: "/settings/status-options",

  defaultSort: { column: "enum_type", direction: "asc" },
  searchableFields: ["enum_type", "value", "label", "description"],

  detailHeader: {
    title: "label",
    subtitle: "enum_type",
  },

  formSchema: enumValueSchema,

  queryExamples: [
    "List all batch statuses",
    "Get valid vessel types",
    "What user roles exist?",
    "Show dropdown options with colors",
  ],

  keyFields: ["enum_type", "value", "label", "is_active"],
};
