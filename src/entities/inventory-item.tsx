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
  supplier: z.string().nullable().optional(),
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
    hops: { label: "Hops", color: "success" },
    yeast: { label: "Yeast", color: "info" },
    adjunct: { label: "Adjunct", color: "warning" },
    packaging: { label: "Packaging", color: "default" },
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
      accessorKey: "reorder_point",
      header: "Reorder Point",
      sortable: true,
    },
    {
      accessorKey: "supplier",
      header: "Supplier",
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
  searchableFields: ["name", "sku", "supplier"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "name",
    subtitle: "category",
  },

  detailSections: [
    {
      id: "overview",
      title: "Overview",
      fields: [
        { field: "name", label: "Name" },
        { field: "category", label: "Category" },
        { field: "sku", label: "SKU" },
        { field: "unit", label: "Unit of Measure" },
        { field: "is_active", label: "Active" },
      ],
    },
    {
      id: "reorder",
      title: "Reorder Settings",
      fields: [
        { field: "reorder_point", label: "Reorder Point" },
        { field: "reorder_qty", label: "Reorder Quantity" },
        { field: "supplier", label: "Preferred Supplier" },
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
  ],

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
          options: [
            { value: "lb", label: "Pounds (lb)" },
            { value: "oz", label: "Ounces (oz)" },
            { value: "kg", label: "Kilograms (kg)" },
            { value: "g", label: "Grams (g)" },
            { value: "each", label: "Each" },
            { value: "case", label: "Case" },
            { value: "gal", label: "Gallons" },
          ],
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
          colSpan: 4,
        },
        {
          name: "supplier",
          label: "Preferred Supplier",
          type: "text",
          placeholder: "e.g., Midwest Malting",
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

  formFields: [
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
      options: [
        { value: "lb", label: "Pounds (lb)" },
        { value: "oz", label: "Ounces (oz)" },
        { value: "kg", label: "Kilograms (kg)" },
        { value: "g", label: "Grams (g)" },
        { value: "each", label: "Each" },
        { value: "case", label: "Case" },
        { value: "gal", label: "Gallons" },
      ],
      colSpan: 6,
    },
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
      colSpan: 4,
    },
    {
      name: "supplier",
      label: "Preferred Supplier",
      type: "text",
      placeholder: "e.g., Midwest Malting",
      colSpan: 4,
    },
    {
      name: "is_active",
      label: "Active",
      type: "switch",
      description: "Inactive items won't appear in selection menus",
      defaultValue: true,
      colSpan: 6,
    },
    {
      name: "notes",
      label: "Notes",
      type: "textarea",
      placeholder: "Storage requirements, alternate suppliers...",
      colSpan: 12,
    },
  ],

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [
    {
      name: "delete",
      label: "Deactivate Inventory Item",
      icon: "trash",
      type: "dropdown",
      variant: "destructive",
      deleteMode: "soft" as const,
    },
  ],

  // ---------------------------------------------------------------------------
  // Value Display
  // ---------------------------------------------------------------------------
  valueDisplay: [categoryDisplayConfig],

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------
  relations: [],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "Show me all hops in inventory",
    "What grain items are below reorder point?",
    "List active packaging supplies",
    "Find items from Yakima Valley Hops",
  ],

  keyFields: ["name", "category", "unit", "reorder_point", "is_active"],
};
