/**
 * Chat confirm-gated write contract (Phase 4C, extended in Phase 4B).
 *
 * Single source of truth for the payload that flows through the AI chat
 * write path: a chat tool returns a `ConfirmWriteIntent` (a *pending* write),
 * the chat panel renders it as a Confirm/Cancel card, and on confirm the
 * client POSTs the `ChatWriteRequest` portion to `/api/chat/write`, which
 * re-validates it here and executes under the caller's session client so
 * RLS remains the authority.
 *
 * Every member of `chatWriteRequestSchema` spells out its own fields. This is
 * deliberately NOT a generic `{ table, payload }` passthrough: the union IS
 * the trust boundary, so a model can only ever propose a shape that was
 * explicitly designed and permission-mapped here.
 *
 * Server-safe: zod only, no React.
 */

import { z } from "zod";
import type { ReadingType } from "@/domain/batch-readings";
import type { Permission } from "@/lib/permissions";

/** Batch states that accept fermentation readings. */
export const READING_ELIGIBLE_STATES = [
  "fermenting",
  "conditioning",
  "packaging",
] as const;

// Mirrors ReadingType in src/domain/batch-readings.ts; the `satisfies` check
// below breaks the build if the two drift.
const readingTypeSchema = z.enum([
  "gravity",
  "temperature",
  "ph",
  "pressure",
  "dissolved_oxygen",
  "diacetyl",
  "clarity",
]);
({}) as z.infer<typeof readingTypeSchema> satisfies ReadingType;

/** The `data` payload stored on a `batch_logs` measurement row. */
export const batchReadingSchema = z.object({
  reading_type: readingTypeSchema,
  value: z.union([z.number(), z.string()]),
  unit: z.string().min(1),
  timestamp: z.string().min(1),
  notes: z.string().optional(),
});

/**
 * Batch states the chat may transition *into*. A strict subset of
 * `batchTransitions`: `cancelled` and `archived` are excluded because the
 * batch state machine marks them `requiresAction` — they must run the
 * cancel/archive RPCs (vessel release, TTB loss), not a bare transition.
 */
export const CHAT_TRANSITION_STATES = [
  "fermenting",
  "conditioning",
  "packaging",
  "completed",
] as const;

/** ISO calendar date, `YYYY-MM-DD`. */
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date");

/**
 * Everything `/api/chat/write` accepts. Each confirm-gated write is its own
 * discriminated-union member with explicit, individually-validated fields.
 */
export const chatWriteRequestSchema = z.discriminatedUnion("writeAction", [
  z.object({
    writeAction: z.literal("add_batch_reading"),
    params: z.object({
      batchId: z.string().uuid(),
      reading: batchReadingSchema,
    }),
  }),
  z.object({
    writeAction: z.literal("transition_batch"),
    params: z.object({
      batchId: z.string().uuid(),
      toState: z.enum(CHAT_TRANSITION_STATES),
    }),
  }),
  z.object({
    writeAction: z.literal("create_packaging_session"),
    params: z.object({
      sessionDate: isoDateSchema,
      notes: z.string().max(2000).optional(),
    }),
  }),
  z.object({
    writeAction: z.literal("create_batch"),
    params: z.object({
      recipeId: z.string().uuid(),
      name: z.string().min(1).max(200),
      plannedStartDate: isoDateSchema.optional(),
      volumeBbl: z.number().positive().max(10000).optional(),
    }),
  }),
]);

export type ChatWriteRequest = z.infer<typeof chatWriteRequestSchema>;

/** Discriminator values accepted by `/api/chat/write`. */
export type ChatWriteAction = ChatWriteRequest["writeAction"];

/**
 * Permission required per write, resolved *after* the payload is parsed so
 * each action is gated on its own target rather than one blanket permission.
 *
 * All four writes land in the production domain today, so they all resolve to
 * `batches:write` (matching `DOMAIN_WRITE_PERMISSIONS.production` and
 * `.packaging` in `src/lib/permissions.ts` — the permission vocabulary has no
 * finer packaging/creation split). The map exists so adding a write against a
 * different domain (an order, a purchase order) cannot inherit batch rights by
 * accident: a new union member without an entry fails to type-check.
 */
export const CHAT_WRITE_PERMISSIONS: Record<ChatWriteAction, Permission> = {
  add_batch_reading: "batches:write",
  transition_batch: "batches:write",
  create_packaging_session: "batches:write",
  create_batch: "batches:write",
};

/**
 * What a confirm-gated chat tool returns: the exact write request plus the
 * card copy. `action: "confirm_write"` is the client's render discriminator
 * (the sibling of NavigationIntent's `action: "navigate"`).
 */
export type ConfirmWriteIntent = ChatWriteRequest & {
  action: "confirm_write";
  description: string;
};
