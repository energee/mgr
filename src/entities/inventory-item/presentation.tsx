/**
 * Inventory Item Entity — presentation
 *
 * The React/UI half of the inventory item entity: list columns, list filters,
 * and the unified detail/edit sections.
 */

import type { EntityPresentation } from "@/types/entity";
import { deleteAction, valuesAsOptions } from "@/types/entity";
import { StatusBadge } from "@/components/universal/status-badge";
import type { InventoryItem } from "./core";
import { categoryDisplayConfig } from "./core";

export const inventoryItemPresentation: EntityPresentation<InventoryItem> = {
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
        const display = categoryDisplayConfig.display[value as string];
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
  // Actions
  // ---------------------------------------------------------------------------
  actions: [deleteAction("Inventory Item")],
};
