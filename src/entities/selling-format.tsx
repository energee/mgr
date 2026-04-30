/**
 * Selling Format Entity Configuration
 *
 * Selling formats define how a container is grouped for sale — single, 4-pack,
 * case of 24, per keg. Each selling format belongs to one container.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";
import type { Database } from "@/types/supabase";
import { SellingFormatBOMEditor } from "@/components/domain/selling-format-bom-editor";

type SellingFormat = Database["public"]["Tables"]["selling_formats"]["Row"];

// Wrapper to adapt SellingFormatBOMEditor to the relation component interface
function BOMRelation({ parentId }: { parentId: string }) {
  return <SellingFormatBOMEditor sellingFormatId={parentId} />;
}

// =============================================================================
// Zod Schema
// =============================================================================

/** Coerce empty/null/undefined to null, otherwise to Number — for optional integer fields. */
const optionalInt = z.preprocess(
  (v) => (v === "" || v == null ? null : Number(v)),
  z.number().int().positive("Must be positive").nullable().optional()
);

export const sellingFormatSchema = z.object({
  name: z.string().min(1, "Name is required"),
  container_id: z.string().uuid("Container is required"),
  unit_count: z.coerce.number().int().positive("Unit count must be positive").default(1),
  units_per_layer: optionalInt,
  default_layers: optionalInt,
  pallet_quantity: optionalInt,
  is_active: z.boolean().default(true),
  position: z.coerce.number().int().min(0).default(0),
});

export type SellingFormatFormValues = z.infer<typeof sellingFormatSchema>;

// =============================================================================
// Entity Configuration
// =============================================================================

export const sellingFormatEntity: EntityConfig<SellingFormat> = {
  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------
  name: "selling_format",
  table: "selling_formats",
  displayName: "Selling Format",
  displayNamePlural: "Selling Formats",
  description: "How a container is grouped for sale — single, 4-pack, case, per keg.",
  domain: "inventory",

  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "name",
      header: "Name",
      sortable: true,
    },
    {
      accessorKey: "container_id",
      header: "Container",
      sortable: true,
      relation: {
        entity: "container",
        displayField: "name",
      },
    },
    {
      accessorKey: "unit_count",
      header: "Units",
      sortable: true,
    },
    {
      accessorKey: "is_active",
      header: "Active",
      sortable: true,
      render: (value) => (value ? "Yes" : "No"),
    },
  ],

  listFilters: [
    {
      field: "is_active",
      type: "boolean",
      label: "Active",
    },
  ],

  defaultSort: { column: "position", direction: "asc" },
  searchableFields: ["name"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "name",
  },

  // ---------------------------------------------------------------------------
  // Unified Sections (detail + edit)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Selling Format Details",
      fields: [
        {
          name: "name",
          label: "Name",
          type: "text",
          placeholder: "e.g., Single, 4-Pack, Case of 24, Per Keg",
          required: true,
          colSpan: 6,
        },
        {
          name: "container_id",
          label: "Container",
          type: "relation",
          relation: {
            entity: "container",
            displayField: "name",
          },
          required: true,
          colSpan: 6,
        },
        {
          name: "unit_count",
          label: "Unit Count",
          type: "number",
          placeholder: "e.g., 1, 4, 6, 24",
          description: "Number of containers in this selling format",
          required: true,
          colSpan: 4,
        },
        {
          name: "position",
          label: "Display Order",
          type: "number",
          placeholder: "e.g., 10, 20, 30",
          description: "Order in dropdown menus (lower numbers appear first)",
          colSpan: 4,
        },
        {
          name: "is_active",
          label: "Active",
          type: "switch",
          description: "Inactive formats won't appear in dropdown menus",
          defaultValue: true,
          colSpan: 4,
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
      id: "pallet",
      title: "Pallet Configuration",
      fields: [
        {
          name: "units_per_layer",
          label: "Units Per Layer",
          type: "number",
          placeholder: "e.g., 25",
          description: "How many of this format fit in one pallet layer",
          colSpan: 4,
        },
        {
          name: "default_layers",
          label: "Default Layers",
          type: "number",
          placeholder: "e.g., 4",
          description: "Default number of layers per pallet",
          colSpan: 4,
        },
        {
          name: "pallet_quantity",
          label: "Pallet Quantity",
          type: "number",
          description: "Auto-calculated: units_per_layer × default_layers",
          editable: false,
          colSpan: 4,
        },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: sellingFormatSchema,

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [
    {
      name: "delete",
      label: "Delete Selling Format",
      icon: "trash",
      type: "dropdown",
      variant: "destructive",
      deleteMode: "hard",
    },
  ],

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
  relations: [
    {
      name: "bill_of_materials",
      entity: "selling_format_material",
      type: "hasMany" as const,
      foreignKey: "selling_format_id",
      showInDetail: true,
      detailTab: "Bill of Materials",
      component: BOMRelation,
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "Show all selling formats",
    "What formats are available for 12oz cans?",
    "List active selling formats with unit counts",
  ],

  keyFields: ["name", "container_id", "unit_count", "is_active"],
};
