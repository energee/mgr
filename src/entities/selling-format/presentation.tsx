/**
 * Selling Format Entity — presentation
 *
 * The React/UI half of the selling format entity: list columns, list filters,
 * the unified detail/edit sections, and the bill-of-materials relation component.
 */

import type { EntityPresentation } from "@/types/entity";
import { deleteAction } from "@/types/entity";
import { SellingFormatBOMEditor } from "@/components/domain/packaging/selling-format-bom-editor";
import type { SellingFormat } from "./core";

/** Relation-tab wrapper for the per-format bill of materials editor. */
function BOMRelation({ parentId }: { parentId: string }) {
  return <SellingFormatBOMEditor sellingFormatId={parentId} />;
}

export const sellingFormatPresentation: EntityPresentation<SellingFormat> = {
  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "name",
      header: "Name",
    },
    {
      accessorKey: "container_id",
      header: "Container",
      relation: {
        entity: "container",
        displayField: "name",
      },
    },
    {
      accessorKey: "unit_count",
      header: "Units",
    },
    {
      accessorKey: "is_active",
      header: "Active",
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
  // Actions
  // ---------------------------------------------------------------------------
  actions: [deleteAction("Selling Format")],

  // ---------------------------------------------------------------------------
  // Relation components — woven onto `core.relations` by createEntityConfig()
  // ---------------------------------------------------------------------------
  relationComponents: {
    bill_of_materials: BOMRelation,
  },
};
