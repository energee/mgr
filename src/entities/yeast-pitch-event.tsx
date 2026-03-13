/**
 * Yeast Pitch Event Entity Configuration
 *
 * Records individual pitch events — when yeast is pitched to a batch.
 * Tracks quantity, viability at pitch time, and cell count.
 * Referenced by yeast_pitch relation for Usage History tab.
 */

import { z } from "zod";
import type { EntityConfig } from "@/types/entity";
import type { Database } from "@/types/supabase";

type YeastPitchEvent = Database["public"]["Tables"]["yeast_pitch_events"]["Row"];

export const yeastPitchEventSchema = z.object({
  pitch_id: z.string().uuid(),
  batch_id: z.string().uuid(),
  quantity_lbs: z.coerce.number().min(0),
  pitched_at: z.string().optional(),
  viability_at_pitch: z.coerce.number().min(0).max(100).nullable().optional(),
  cells_pitched_thousand: z.coerce.number().min(0).nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type YeastPitchEventFormValues = z.infer<typeof yeastPitchEventSchema>;

export const yeastPitchEventEntity: EntityConfig<YeastPitchEvent> = {
  name: "yeast_pitch_event",
  table: "yeast_pitch_events",
  displayName: "Pitch Event",
  displayNamePlural: "Pitch Events",
  description: "Records of yeast being pitched to batches",
  domain: "production",

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
      render: (value) => (value != null ? `${Number(value).toFixed(1)}` : "\u2014"),
    },
    {
      accessorKey: "viability_at_pitch",
      header: "Viability",
      sortable: true,
      render: (value) => (value != null ? `${Math.round(Number(value))}%` : "\u2014"),
    },
  ],

  defaultSort: { column: "pitched_at", direction: "desc" },
  searchableFields: [],

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

  formSchema: yeastPitchEventSchema,
};
