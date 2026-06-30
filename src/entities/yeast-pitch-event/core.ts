/**
 * Yeast Pitch Event Entity — server-safe core
 *
 * The pure-data half of the yeast pitch event entity: identity, the zod form
 * schema, and AI metadata. No React imports — safe to import from server
 * route handlers and API routes.
 *
 * Records individual pitch events — when yeast is pitched to a batch.
 * Tracks quantity, viability at pitch time, and cell count.
 * Referenced by yeast_pitch relation for Usage History tab.
 */

import { z } from "zod";
import type { EntityCoreInput } from "@/types/entity";
import type { Database } from "@/types/supabase";

// =============================================================================
// Types
// =============================================================================

export type YeastPitchEvent = Database["public"]["Tables"]["yeast_pitch_events"]["Row"];

// =============================================================================
// Zod Schema
// =============================================================================

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

// =============================================================================
// Entity Core
// =============================================================================

export const yeastPitchEventCore: EntityCoreInput<YeastPitchEvent> = {
  name: "yeast_pitch_event",
  table: "yeast_pitch_events",
  displayName: "Pitch Event",
  description: "Records of yeast being pitched to batches",
  domain: "production",
  basePath: null,

  // Explicit: sort by pitch time descending, not by name.
  defaultSort: { column: "pitched_at", direction: "desc" },
  // Explicit: no searchable text fields on this entity.
  searchableFields: [],

  formSchema: yeastPitchEventSchema,
};
