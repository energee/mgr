/**
 * Finished Good Entity Configuration
 *
 * Finished goods represent packaged products ready for sale.
 * They are created through packaging sessions and tracked with lot numbers.
 * Each finished good references a selling_format (unified container packaging).
 *
 * This is a read-only entity view - finished goods are created by packaging sessions.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";
import type { Database } from "@/types/supabase";
import { createRevisionHistoryDisplay } from "@/components/domain/revision-history-display";
import { FGInventorySection } from "@/components/domain/fg-inventory-section";

// Use the view type for availability calculations
type FinishedGoodView = Database["public"]["Views"]["finished_goods_with_availability"]["Row"];

// =============================================================================
// Zod Schema (for future edit support if needed)
// =============================================================================

export const finishedGoodSchema = z.object({
  lot_number: z.string().min(1, "Lot number is required"),
  brand_id: z.string().uuid(),
  selling_format_id: z.string().uuid().nullable().optional(),
  batch_id: z.string().uuid().nullable().optional(),
  quantity: z.coerce.number().int().min(0),
  production_date: z.string().nullable().optional(),
  best_by_date: z.string().nullable().optional(),
  expiration_date: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

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
    // Note: dynamicOptions not yet supported in EntityFilterDef type
    // For now using basic filters, will add brand/selling format when type supports it
  ],

  defaultSort: { column: "production_date", direction: "desc" },
  searchableFields: ["lot_number", "notes"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "lot_number",
  },

  detailSections: [
    {
      id: "overview",
      title: "Product Information",
      fields: [
        { field: "lot_number", label: "Lot Code" },
        { field: "brand_id", label: "Brand" },
        { field: "selling_format_id", label: "Selling Format" },
        { field: "batch_id", label: "Source Batch" },
      ],
    },
    {
      id: "inventory",
      title: "Inventory",
      component: FGInventorySection,
    },
    {
      id: "dates",
      title: "Dates",
      fields: [
        { field: "production_date", label: "Production Date" },
        { field: "best_by_date", label: "Best By" },
        { field: "expiration_date", label: "Expiration" },
      ],
    },
    {
      id: "notes",
      title: "Notes",
      fields: [
        { field: "notes", label: "Notes", fullWidth: true },
      ],
      collapsible: true,
    },
    {
      id: "revision-history",
      title: "Revision History",
      component: createRevisionHistoryDisplay("finished_goods"),
      collapsible: true,
    },
  ],

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
          relation: { entity: "batch", displayField: "batch_number" },
        },
      ],
    },
    {
      id: "inventory",
      title: "Inventory",
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
      component: createRevisionHistoryDisplay("finished_goods"),
      collapsible: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // Form (read-only entity, minimal form for future use)
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
