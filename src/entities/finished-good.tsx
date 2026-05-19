/**
 * Finished Good Entity Configuration
 *
 * Finished goods represent packaged products ready for sale.
 * They are created through packaging sessions (internal) or manually (external/contract).
 * Each finished good references a selling_format (unified container packaging).
 *
 * Internal FGs: created automatically when a packaging session completes.
 * External FGs: created manually with notes documenting the source.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";
import type { Database } from "@/types/supabase";
import { createRevisionHistoryDisplay } from "@/components/domain/shared/revision-history-display";
import { FGInventorySection } from "@/components/domain/inventory/fg-inventory-section";

// Use the view type for availability calculations
type FinishedGoodView = Database["public"]["Views"]["finished_goods_with_availability"]["Row"];

// =============================================================================
// Zod Schema
// =============================================================================

export const finishedGoodSchema = z.object({
  lot_number: z.string().min(1, "Lot number is required"),
  brand_id: z.string().uuid(),
  selling_format_id: z.string().uuid().nullable().optional(),
  batch_id: z.string().uuid().nullable().optional(),
  quantity: z.coerce.number().int().min(1, "Quantity must be at least 1"),
  production_date: z.string().nullable().optional(),
  best_by_date: z.string().nullable().optional(),
  expiration_date: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
}).refine(
  (data) => data.batch_id || (data.notes && data.notes.trim().length > 0),
  {
    message: "Notes are required for external finished goods (no source batch)",
    path: ["notes"],
  }
);

export type FinishedGoodFormValues = z.infer<typeof finishedGoodSchema>;

// =============================================================================
// Entity Configuration
// =============================================================================

export const finishedGoodEntity: EntityConfig<FinishedGoodView> = {
  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------
  name: "finished_good",
  table: "finished_goods",
  viewTable: "finished_goods_with_availability",
  displayName: "Finished Good",
  displayNamePlural: "Finished Goods",
  description: "Packaged products ready for sale",
  domain: "inventory",

  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "lot_number",
      header: "Lot Code",
      sortable: true,
    },
    {
      accessorKey: "brand_name",
      header: "Brand",
      sortable: true,
    },
    {
      accessorKey: "selling_format_name",
      header: "Format",
      sortable: true,
    },
    {
      accessorKey: "quantity",
      header: "Total",
      sortable: true,
    },
    {
      accessorKey: "available_quantity",
      header: "Available",
      sortable: true,
    },
    {
      accessorKey: "production_date",
      header: "Packaged",
      sortable: true,
    },
  ],

  listFilters: [
    {
      field: "brand_id",
      type: "select",
      label: "Brand",
      dynamicOptions: {
        table: "brands",
        valueField: "id",
        labelField: "name",
        orderBy: "name",
      },
    },
    {
      field: "selling_format_id",
      type: "select",
      label: "Format",
      dynamicOptions: {
        table: "selling_formats",
        valueField: "id",
        labelField: "name",
        orderBy: "name",
      },
    },
  ],

  defaultSort: { column: "production_date", direction: "desc" },
  searchableFields: ["lot_number", "brand_name", "selling_format_name", "notes"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "lot_number",
    subtitle: "brand_name" as keyof FinishedGoodView & string,
  },

  // ---------------------------------------------------------------------------
  // Unified Sections (detail + edit)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Product Information",
      fields: [
        {
          name: "lot_number",
          label: "Lot Code",
          type: "text",
          required: true,
          colSpan: 6,
        },
        {
          name: "quantity",
          label: "Quantity",
          type: "number",
          required: true,
          colSpan: 6,
        },
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
          name: "batch_id",
          label: "Source Batch",
          type: "relation",
          colSpan: 6,
          relation: { entity: "batch", displayField: "batch_code" },
        },
      ],
    },
    {
      id: "inventory",
      title: "Inventory",
      hideOnCreate: true,
      component: FGInventorySection,
    },
    {
      id: "dates",
      title: "Dates",
      fields: [
        {
          name: "production_date",
          label: "Production Date",
          type: "date",
          format: "date",
          colSpan: 4,
        },
        {
          name: "best_by_date",
          label: "Best By",
          type: "date",
          format: "date",
          colSpan: 4,
        },
        {
          name: "expiration_date",
          label: "Expiration",
          type: "date",
          format: "date",
          colSpan: 4,
        },
      ],
    },
    {
      id: "notes",
      title: "Notes",
      collapsible: true,
      fields: [
        {
          name: "notes",
          label: "Notes",
          type: "textarea",
          fullWidth: true,
          colSpan: 12,
        },
      ],
    },
    {
      id: "revision-history",
      title: "Revision History",
      hideOnCreate: true,
      component: createRevisionHistoryDisplay("finished_goods"),
      collapsible: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: finishedGoodSchema,

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
  relations: [
    {
      name: "batch",
      entity: "batch",
      type: "belongsTo",
      foreignKey: "batch_id",
    },
    {
      name: "allocations",
      entity: "allocation",
      type: "hasMany",
      foreignKey: "source_id",
      showInDetail: true,
      detailTab: "Allocations",
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "Show all finished goods for brand X",
    "What FG has available inventory?",
    "List finished goods expiring this month",
    "Show allocation history for lot Y",
  ],

  keyFields: ["lot_number", "brand_id", "selling_format_id", "quantity", "available_quantity"],
};
