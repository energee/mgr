/**
 * Batch Schema & State Machine Data (server-safe)
 *
 * Extracted from src/entities/batch.tsx so API routes can import
 * without pulling in client-side component dependencies.
 * The entity config re-exports these to remain the single source of truth.
 */

import { z } from "zod";

// =============================================================================
// State Machine Data
// =============================================================================
// Declared before the schema so `batchSchema.status` can validate against it.

export const batchStates = [
  "planned",
  "fermenting",
  "conditioning",
  "packaging",
  "completed",
  "cancelled",
  "archived",
] as const;

export type BatchState = (typeof batchStates)[number];

// =============================================================================
// Zod Schema
// =============================================================================

export const batchSchema = z.object({
  batch_code: z.string().optional(),
  name: z.string().min(1, "Name is required"),
  // Machine states only (audit EA-9): this raw schema is imported directly by
  // src/app/api/batches/* (bypassing the entity-config formSchema guard), so
  // the enum must live here. New records still enter at "planned" — the form
  // layer and the batch state machine own WHICH state is allowed when.
  status: z.enum(batchStates).default("planned"),
  recipe_id: z.string().uuid().nullable().optional(),
  recipe_variant_id: z.string().uuid().nullable().optional(),
  planned_start_date: z.string().nullable().optional(),
  volume_bbl: z.coerce.number().nullable().optional(),
  actual_fg: z.coerce.number().nullable().optional(),
  actual_abv: z.coerce.number().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type BatchFormValues = z.infer<typeof batchSchema>;

/**
 * Field-update schema for `PATCH /api/batches/[id]` — every editable column
 * except the machine state.
 *
 * `status` is omitted before `.partial()` for two reasons. It stops a bare
 * status flip from bypassing `transition_entity_atomic` and its side effects
 * (vessel release, ingredient-allocation completion, loss reconciliation) —
 * state changes belong to `POST /api/batches/[id]/transfer`. It also removes
 * `.default("planned")`, which survives `.partial()` in Zod and would otherwise
 * reset the state of any batch patched with unrelated fields.
 */
export const batchUpdateSchema = batchSchema.omit({ status: true }).partial();

export type BatchUpdateValues = z.infer<typeof batchUpdateSchema>;

/** Valid state transitions: { fromState: [toStates] }
 * planned -> fermenting is triggered by Transfer (to fermenter) or Pitch Yeast suggestion.
 * fermenting -> conditioning is triggered by Transfer (to brite tank) suggestion.
 * Direct transitions (start_packaging, complete) use the state machine normally.
 * Cancel/archive are available as escape hatches from active production states. */
export const batchTransitions: Record<string, string[]> = {
  planned: ["fermenting", "cancelled"],
  fermenting: ["conditioning", "archived"],
  conditioning: ["packaging", "archived"],
  packaging: ["completed", "archived"],
  completed: [],
  cancelled: [],
  archived: [],
};
