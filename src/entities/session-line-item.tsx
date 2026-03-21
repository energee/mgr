/**
 * Session Line Item Entity Configuration
 *
 * Line items within a packaging session. Each line item represents
 * a product (brand + selling format) being packaged from a single
 * source batch.
 *
 * Used as a relation from packaging-session entity.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";
import type { Database } from "@/types/supabase";

type SessionLineItem = Database["public"]["Tables"]["session_line_items"]["Row"];

// =============================================================================
// Zod Schema
// =============================================================================

export const sessionLineItemSchema = z.object({
  session_id: z.string().uuid(),
  brand_id: z.string().uuid({ message: "Brand is required" }),
  selling_format_id: z.string().uuid().nullable().optional(),
  keg_owner_id: z.string().uuid().nullable().optional(),
  batch_id: z.string().uuid().nullable().optional(),
  planned_quantity: z.coerce.number().int().nullable().optional(),
  actual_quantity: z.coerce.number().int().nullable().optional(),
});

export type SessionLineItemFormValues = z.infer<typeof sessionLineItemSchema>;

// =============================================================================
// Entity Configuration
// =============================================================================

export const sessionLineItemEntity: EntityConfig<SessionLineItem> = {
  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------
  name: "session_line_item",
  table: "session_line_items",
  displayName: "Line Item",
  displayNamePlural: "Line Items",
  description: "Products packaged in a session",
  domain: "production",

  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "brand_id",
      header: "Brand",
      sortable: true,
      relation: {
        entity: "brand",
        displayField: "name",
      },
    },
    {
      accessorKey: "selling_format_id",
      header: "Selling Format",
      sortable: true,
      relation: {
        entity: "selling_format",
        displayField: "name",
      },
    },
    {
      accessorKey: "planned_quantity",
      header: "Planned",
      sortable: true,
      render: (value) => value ? `${value}` : "—",
    },
    {
      accessorKey: "actual_quantity",
      header: "Actual",
      sortable: true,
      render: (value) => value ? `${value}` : "—",
    },
  ],

  listFilters: [],

  defaultSort: { column: "created_at", direction: "asc" },
  searchableFields: [],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "brand_id",
  },

  // ---------------------------------------------------------------------------
  // Unified Sections (detail + edit)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Line Item Details",
      fields: [
        {
          name: "brand_id",
          label: "Brand",
          type: "select",
          required: true,
          colSpan: 6,
          dynamicOptions: {
            table: "brands",
            valueField: "id",
            labelField: "name",
            orderBy: "name",
          },
        },
        {
          name: "selling_format_id",
          label: "Selling Format",
          type: "relation",
          colSpan: 6,
          relation: { entity: "selling_format", displayField: "name" },
        },
        {
          name: "keg_owner_id",
          label: "Keg Owner",
          type: "relation",
          colSpan: 6,
          relation: { entity: "keg_owner", displayField: "name" },
          description: "Fleet owner for keg packaging",
        },
        {
          name: "planned_quantity",
          label: "Planned Quantity",
          type: "number",
          placeholder: "Units to package",
          colSpan: 6,
        },
        {
          name: "actual_quantity",
          label: "Actual Quantity",
          type: "number",
          placeholder: "Actual units packaged",
          colSpan: 6,
        },
        {
          name: "created_at",
          label: "Created",
          format: "datetime",
          editable: false,
          colSpan: 6,
        },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: sessionLineItemSchema,

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
  relations: [
    {
      name: "session",
      entity: "packaging_session",
      type: "belongsTo",
      foreignKey: "session_id",
    },
    {
      name: "selling_format",
      entity: "selling_format",
      type: "belongsTo",
      foreignKey: "selling_format_id",
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "Show line items for session X",
    "What was packaged in the last session?",
    "Total units packaged by brand",
  ],

  keyFields: ["brand_id", "batch_id", "selling_format_id", "planned_quantity", "actual_quantity"],
};
