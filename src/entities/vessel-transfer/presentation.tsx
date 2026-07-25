/**
 * Vessel Transfer Entity — presentation
 *
 * The React/UI half of the vessel transfer entity: list columns and the
 * unified detail/edit sections.
 */

import type { EntityPresentation } from "@/types/entity";
import type { VesselTransfer } from "./core";

export const vesselTransferPresentation: EntityPresentation<VesselTransfer> = {
  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "batch_code",
      header: "Batch",
    },
    {
      accessorKey: "transferred_at",
      header: "Date/Time",
      format: "datetime",
    },
    {
      accessorKey: "from_vessel_name",
      header: "From",
      render: (value) => {
        if (!value) return "Kettle (knockout)";
        return String(value);
      },
    },
    {
      accessorKey: "to_vessel_name",
      header: "To",
    },
    {
      accessorKey: "volume_bbl",
      header: "Volume",
      format: "unit",
      unitType: "volume",
    },
    {
      accessorKey: "notes",
      header: "Notes",
    },
  ],

  // ---------------------------------------------------------------------------
  // Unified Sections (detail + edit)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Transfer Details",
      fields: [
        {
          name: "batch_id",
          label: "Batch",
          type: "relation",
          relation: { entity: "batch", displayField: "batch_code" },
          description: "Batch being transferred",
          required: true,
          colSpan: 12,
        },
        {
          name: "transferred_at",
          label: "Date/Time",
          type: "datetime",
          format: "datetime",
          description: "When the transfer occurred",
          required: true,
          defaultValue: () => new Date().toISOString(),
          colSpan: 6,
        },
        {
          name: "from_vessel_id",
          label: "From Vessel",
          type: "relation",
          relation: { entity: "vessel", displayField: "name" },
          description: "Source vessel (leave empty for knockout from kettle)",
          colSpan: 6,
        },
        {
          name: "to_vessel_id",
          label: "To Vessel",
          type: "relation",
          relation: { entity: "vessel", displayField: "name" },
          description: "Destination vessel",
          required: true,
          colSpan: 6,
        },
        {
          name: "volume_bbl",
          label: "Volume",
          type: "unit",
          unitType: "volume",
          format: "unit",
          description: "Volume transferred",
          required: true,
          colSpan: 6,
        },
        {
          name: "notes",
          label: "Notes",
          type: "textarea",
          description: "Additional notes about the transfer",
          colSpan: 12,
        },
      ],
    },
  ],
};
