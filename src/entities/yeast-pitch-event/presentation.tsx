/**
 * Yeast Pitch Event Entity — presentation
 *
 * The React/UI half of the yeast pitch event entity: list columns and the
 * unified detail/edit sections.
 */

import type { EntityPresentation } from "@/types/entity";
import type { YeastPitchEvent } from "./core";

export const yeastPitchEventPresentation: EntityPresentation<YeastPitchEvent> = {
  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "pitched_at",
      header: "Pitched",
      sortable: true,
    },
    {
      accessorKey: "batch_id",
      header: "Batch",
      sortable: true,
    },
    {
      accessorKey: "quantity_lbs",
      header: "Qty (lbs)",
      sortable: true,
      render: (value) => (value != null ? `${Number(value).toFixed(1)}` : "—"),
    },
    {
      accessorKey: "viability_at_pitch",
      header: "Viability",
      sortable: true,
      render: (value) => (value != null ? `${Math.round(Number(value))}%` : "—"),
    },
  ],

  // ---------------------------------------------------------------------------
  // Unified Sections (detail + edit)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "overview",
      title: "Event Details",
      fields: [
        {
          name: "pitch_id",
          label: "Yeast Pitch",
          type: "relation",
          relation: { entity: "yeast_pitch", displayField: "strain_name" },
          required: true,
          colSpan: 6,
        },
        {
          name: "batch_id",
          label: "Batch",
          type: "relation",
          relation: { entity: "batch", displayField: "name" },
          required: true,
          colSpan: 6,
        },
        {
          name: "quantity_lbs",
          label: "Quantity (lbs)",
          type: "number",
          format: "number",
          required: true,
          colSpan: 4,
        },
        {
          name: "viability_at_pitch",
          label: "Viability at Pitch (%)",
          type: "number",
          format: "percentage",
          colSpan: 4,
        },
        {
          name: "cells_pitched_thousand",
          label: "Cells Pitched (Thousand)",
          type: "number",
          format: "number",
          colSpan: 4,
        },
        {
          name: "pitched_at",
          label: "Pitched At",
          type: "datetime",
          format: "datetime",
          colSpan: 6,
        },
        {
          name: "notes",
          label: "Notes",
          type: "textarea",
          colSpan: 12,
        },
      ],
    },
  ],
};
