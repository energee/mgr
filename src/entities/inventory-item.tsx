/**
 * Inventory Item Entity Configuration
 *
 * Inventory items are raw materials, packaging supplies, and other
 * consumables tracked in the brewery's inventory system.
 */

import { z } from "zod";
import type { EntityConfig, ValueDisplayConfig } from "@/types/entity";
import { valuesAsOptions, getValueDisplay } from "@/types/entity";
import type { Database } from "@/types/supabase";
import { StatusBadge } from "@/components/universal/status-badge";
import { ItemOnHandCell } from "@/components/domain/inventory/item-on-hand-cell";
import { INVENTORY_UNIT_OPTIONS } from "@/domain/inventory-units";

type InventoryItem = Database["public"]["Tables"]["inventory_items"]["Row"];

// =============================================================================
// Zod Schema
// =============================================================================

export const inventoryItemSchema = z.object({
  name: z.string().min(1, "Name is required"),
  category: z.string().min(1, "Category is required"),
  sku: z.string().nullable().optional(),
  unit: z.string().min(1, "Unit is required"),
  reorder_point: z.coerce.number().nullable().optional(),
  reorder_qty: z.coerce.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
});

export type InventoryItemFormValues = z.infer<typeof inventoryItemSchema>;

// =============================================================================
// Value Display Configuration
// =============================================================================

const categoryDisplayConfig: ValueDisplayConfig = {
  field: "category",
  display: {
    grain: { label: "Grain", color: "default" },
    hop: { label: "Hop", color: "success" },
    yeast: { label: "Yeast", color: "info" },
    adjunct: { label: "Adjunct", color: "warning" },
    chemical: { label: "Chemical", color: "info" },
    packaging: { label: "Packaging", color: "default" },
    equipment: { label: "Equipment", color: "default" },
    other: { label: "Other", color: "default" },
  },
};

// =============================================================================
// Entity Configuration
// =============================================================================

export const inventoryItemEntity: EntityConfig<InventoryItem> = {
  name: "inventory_item",
  table: "inventory_items",
  displayName: "Inventory Item",
  displayNamePlural: "Inventory Items",
  description: "Raw materials, packaging, and supplies",
  domain: "inventory",
  basePath: "/inventory/items",

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
      accessorKey: "category",
      header: "Category",
      sortable: true,
      render: (value) => {
        const display = getValueDisplay(inventoryItemEntity, "category", value as string);
        return (
          <StatusBadge
            status={value as string}
            config={display ? { [value as string]: { label: display.label, color: display.color || "default" } } : undefined}
          />
        );
      },
    },
    {
      accessorKey: "sku",
      header: "SKU",
      sortable: true,
    },
    {
      accessorKey: "unit",
      header: "Unit",
      sortable: true,
    },
    {
      // Virtual column (no inventory_items column): each cell reads the
      // item's total from one shared lots-with-quantities query — see
      // ItemOnHandCell. Not sortable because the value never hits the DB
      // query for this list.
      accessorKey: "on_hand",
      header: "On Hand",
      sortable: false,
      render: (_value, row) => <ItemOnHandCell itemId={row.id} unit={row.unit} />,
    },
    {
      accessorKey: "reorder_point",
      header: "Reorder Point",
      sortable: true,
    },
    {
      accessorKey: "is_active",
      header: "Active",
      sortable: true,
      render: (value) => value ? "Yes" : "No",
    },
  ],

  listFilters: [
    {
      field: "category",
      type: "multiselect",
      label: "Category",
      options: valuesAsOptions(categoryDisplayConfig),
    },
    {
      field: "is_active",
      type: "boolean",
      label: "Active",
    },
  ],

  defaultSort: { column: "name", direction: "asc" },
  searchableFields: ["name", "sku"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "name",
    subtitle: "category",
  },

  // ---------------------------------------------------------------------------
  // Unified Sections (for EntityDetailUnified)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Overview",
      fields: [
        {
          name: "name",
          label: "Item Name",
          type: "text",
          placeholder: "e.g., Pale Malt (2-Row)",
          required: true,
          colSpan: 6,
        },
        {
          name: "category",
          label: "Category",
          type: "select",
          required: true,
          options: valuesAsOptions(categoryDisplayConfig),
          colSpan: 6,
        },
        {
          name: "sku",
          label: "SKU",
          type: "text",
          placeholder: "e.g., GRAIN-001",
          colSpan: 6,
        },
        {
          name: "unit",
          label: "Unit of Measure",
          type: "select",
          required: true,
          // Shared with inventory lots and PO line items so units stay
          // consistent across the purchasing → inventory flow.
          options: INVENTORY_UNIT_OPTIONS,
          colSpan: 6,
        },
        {
          name: "is_active",
          label: "Active",
          type: "switch",
          description: "Inactive items won't appear in selection menus",
          defaultValue: true,
          colSpan: 6,
        },
      ],
    },
    {
      id: "reorder",
      title: "Reorder Settings",
      fields: [
        {
          name: "reorder_point",
          label: "Reorder Point",
          type: "number",
          placeholder: "e.g., 100",
          description: "Minimum quantity before reorder alert",
          colSpan: 4,
        },
        {
          name: "reorder_qty",
          label: "Reorder Quantity",
          type: "number",
          placeholder: "e.g., 500",
          description: "Standard quantity to reorder",
          colSpan: 6,
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
          placeholder: "Storage requirements, alternate suppliers...",
          fullWidth: true,
          colSpan: 12,
        },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: inventoryItemSchema,

  // Framework Duplicate action (EntityDetailUnified): SKU is identity and
  // must not carry over; everything else (category, unit, reorder levels)
  // copies so similar items start one edit away.
  excludeOnDuplicate: ["sku"],

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [
    {
      name: "delete",
      label: "Delete Inventory Item",
      icon: "trash",
      type: "dropdown",
      variant: "destructive",
      deleteMode: "hard",
    },
  ],

  // ---------------------------------------------------------------------------
  // Value Display
  // ---------------------------------------------------------------------------
  valueDisplay: [categoryDisplayConfig],

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
  relations: [
    {
      // Lots tab on item detail: shows each lot's remaining quantity (via
      // the inventory_lot entity's viewTable) so a counter can see expected
      // stock per lot without leaving the item.
      name: "lots",
      entity: "inventory_lot",
      type: "hasMany",
      foreignKey: "inventory_item_id",
      showInDetail: true,
      detailTab: "Lots",
    },
  ],
};
