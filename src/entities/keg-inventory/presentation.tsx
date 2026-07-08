/**
 * Keg Inventory Entity — presentation
 *
 * The React/UI half of the keg inventory entity: list columns, list filters,
 * and the unified detail/edit sections (read-only).
 */

import type { EntityPresentation } from "@/types/entity";
import { KEG_STATES, type KegInventory } from "./core";

export const kegInventoryPresentation: EntityPresentation<KegInventory> = {
  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "keg_type_name",
      header: "Keg Type",
      sortable: true,
    },
    {
      accessorKey: "keg_owner_name",
      header: "Owner",
      sortable: true,
      render: (value: unknown) => (value ? String(value) : "—"),
    },
    {
      accessorKey: "state",
      header: "State",
      sortable: true,
      render: (value: unknown) => {
        const state = KEG_STATES.find((s) => s.value === value);
        return state?.label || String(value);
      },
    },
    {
      accessorKey: "quantity",
      header: "Quantity",
      sortable: true,
    },
    {
      accessorKey: "location_name",
      header: "Location",
      sortable: true,
      render: (value: unknown) => (value ? String(value) : "—"),
    },
  ],

  listFilters: [
    {
      field: "state",
      type: "select",
      label: "State",
      options: KEG_STATES.map((s) => ({ value: s.value, label: s.label })),
    },
  ],

  // ---------------------------------------------------------------------------
  // Unified Sections (for EntityDetailUnified) — READ ONLY
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Keg Inventory Details",
      fields: [
        { name: "keg_type_name", label: "Keg Type", editable: false },
        { name: "keg_owner_name", label: "Owner", editable: false },
        { name: "state", label: "State", editable: false },
        { name: "quantity", label: "Quantity", editable: false },
        { name: "location_name", label: "Location", editable: false },
      ],
    },
  ],
};
