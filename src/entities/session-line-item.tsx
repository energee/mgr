/**
 * Session Line Item Entity Configuration
 *
 * Line items within a packaging session. Each line item represents
 * a product (brand + package type) being packaged, potentially from
 * multiple source batches.
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
  package_type_id: z.string().uuid().nullable().optional(),
  keg_type_id: z.string().uuid().nullable().optional(),
  keg_owner_id: z.string().uuid().nullable().optional(),
  source_batches: z.array(z.object({
    batch_id: z.string().uuid(),
    planned_qty: z.number().int().nullable(),
    actual_qty: z.number().int().nullable(),
  })).default([]),
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
      accessorKey: "package_type_id",
      header: "Package Type",
      sortable: true,
      relation: {
        entity: "package_type",
        displayField: "name",
      },
    },
    {
      accessorKey: "keg_type_id",
      header: "Keg Type",
      sortable: true,
      relation: {
        entity: "keg_type",
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

  detailSections: [
    {
      id: "overview",
      title: "Line Item Details",
      fields: [
        { field: "brand_id", label: "Brand" },
        { field: "package_type_id", label: "Package Type" },
        { field: "keg_type_id", label: "Keg Type" },
        { field: "keg_owner_id", label: "Keg Owner" },
        { field: "planned_quantity", label: "Planned Quantity" },
        { field: "actual_quantity", label: "Actual Quantity" },
        { field: "created_at", label: "Created" },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: sessionLineItemSchema,

  formFields: [
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
      name: "package_type_id",
      label: "Package Type",
      type: "select",
      required: false,
      colSpan: 6,
      dynamicOptions: {
        table: "package_types",
        valueField: "id",
        labelField: "name",
        orderBy: "name",
      },
    },
    {
      name: "keg_type_id",
      label: "Keg Type",
      type: "relation",
      required: false,
      colSpan: 6,
      relation: { entity: "keg_type", displayField: "name" },
    },
    {
      name: "keg_owner_id",
      label: "Keg Owner",
      type: "relation",
      required: false,
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
  ],

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
      name: "package_type",
      entity: "package_type",
      type: "belongsTo",
      foreignKey: "package_type_id",
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

  keyFields: ["brand_id", "package_type_id", "keg_type_id", "planned_quantity", "actual_quantity"],
};
