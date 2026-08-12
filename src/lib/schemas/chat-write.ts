/**
 * Chat confirm-gated write contract (Phase 4C).
 *
 * Single source of truth for the payload that flows through the AI chat
 * write path: a chat tool returns a `ConfirmWriteIntent` (a *pending* write),
 * the chat panel renders it as a Confirm/Cancel card, and on confirm the
 * client POSTs the `ChatWriteRequest` portion to `/api/chat/write`, which
 * re-validates it here and executes under the caller's session client so
 * RLS remains the authority.
 *
 * Server-safe: zod only, no React.
 */

import { z } from "zod";
import { READING_TYPES, type ReadingType } from "@/domain/batch-readings";

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

/**
 * The `data` payload stored on a `batch_logs` measurement row.
 *
 * `unit` is cross-checked against `READING_TYPES[reading_type].units` here —
 * this route is the actual trust boundary, so a tampered confirm payload
 * (e.g. `psi` on a gravity reading) is rejected before it reaches the
 * database rather than trusted because the proposing tool already checked it.
 */
export const batchReadingSchema = z
  .object({
    reading_type: readingTypeSchema,
    value: z.union([z.number(), z.string()]),
    unit: z.string().min(1),
    // Format-validated even though the route re-stamps this at execution
    // time rather than trusting it (a card confirmed hours after the tool
    // proposed it shouldn't backdate the reading) — malformed input should
    // still fail loudly rather than silently pass through unused.
    timestamp: z
      .string()
      .refine((v) => !Number.isNaN(Date.parse(v)), {
        message: "timestamp must be a valid date string",
      }),
    notes: z.string().optional(),
  })
  .superRefine((reading, ctx) => {
    const config = READING_TYPES[reading.reading_type];
    if (!config.units.includes(reading.unit)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unit"],
        message: `Invalid unit "${reading.unit}" for ${config.label}. Valid units: ${config.units.join(", ")}`,
      });
    }
  });

/**
 * Everything `/api/chat/write` accepts. One-member discriminated union on
 * purpose — this is the extension point for future confirm-gated writes.
 */
export const chatWriteRequestSchema = z.discriminatedUnion("writeAction", [
  z.object({
    writeAction: z.literal("add_batch_reading"),
    params: z.object({
      batchId: z.string().uuid(),
      reading: batchReadingSchema,
    }),
  }),
]);

export type ChatWriteRequest = z.infer<typeof chatWriteRequestSchema>;

/**
 * What a confirm-gated chat tool returns: the exact write request plus the
 * card copy. `action: "confirm_write"` is the client's render discriminator
 * (the sibling of NavigationIntent's `action: "navigate"`).
 */
export type ConfirmWriteIntent = ChatWriteRequest & {
  action: "confirm_write";
  description: string;
};
