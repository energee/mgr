/**
 * Batch Schema & State Machine Data (server-safe)
 *
 * Extracted from src/entities/batch.tsx so API routes can import
 * without pulling in client-side component dependencies.
 * The entity config re-exports these to remain the single source of truth.
 */

import { z } from "zod";

// =============================================================================
// Zod Schema
// =============================================================================

export const batchSchema = z.object({
  batch_number: z.string().min(1, "Batch number is required"),
  name: z.string().min(1, "Name is required"),
  status: z.string().default("planned"),
  recipe_id: z.string().uuid().nullable().optional(),
  recipe_variant_id: z.string().uuid().nullable().optional(),
  planned_start_date: z.string().nullable().optional(),
  volume_bbl: z.coerce.number().nullable().optional(),
  actual_fg: z.coerce.number().nullable().optional(),
  actual_abv: z.coerce.number().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type BatchFormValues = z.infer<typeof batchSchema>;

// =============================================================================
// State Machine Data
// =============================================================================

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

/** Valid state transitions: { fromState: [toStates] } */
export const batchTransitions: Record<string, string[]> = {
  planned: [],
  fermenting: [],
  conditioning: ["packaging"],
  packaging: ["completed"],
  completed: [],
  cancelled: [],
  archived: [],
};
