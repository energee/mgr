/**
 * Confirm-gated AI chat write endpoint (Phase 4C).
 *
 * Executes a write the user explicitly confirmed on a chat action card.
 * The chat tool only *proposes* the write (see `recordBatchReading` in
 * `../tools.ts`); nothing is persisted until the client POSTs the pending
 * payload here. The payload is re-validated with `chatWriteRequestSchema`
 * and executed with the caller's session Supabase client, so RLS — not this
 * route — is the final authority. `withPermission` provides the friendly
 * 403 before a raw RLS denial would surface.
 */

import { withPermission } from "@/lib/api/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { handleApiError } from "@/lib/api/errors";
import { validateReading } from "@/domain/batch-readings";
import {
  chatWriteRequestSchema,
  READING_ELIGIBLE_STATES,
} from "@/lib/schemas/chat-write";

export const POST = withPermission(
  "batches:write",
  async (request, { supabase }) => {
    const parsed = chatWriteRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return errorResponse(
        "VALIDATION_ERROR",
        "Invalid chat write payload",
        parsed.error.issues,
        422,
      );
    }

    // Single writeAction today; add cases here as more writes are gated.
    const { batchId, reading } = parsed.data.params;

    // reading.unit is already cross-checked against the reading type's valid
    // units by batchReadingSchema's superRefine — this route is the trust
    // boundary, so that check can't be skipped by calling it directly with a
    // tampered unit. Pass it through here too, so range checks compare
    // against the canonical unit the config's min/max are defined in (e.g. a
    // Celsius value converted to °F) instead of the raw value.
    const validation = validateReading(
      reading.reading_type,
      reading.value,
      reading.unit,
    );
    if (!validation.valid) {
      return errorResponse(
        "VALIDATION_ERROR",
        validation.warning ?? "Invalid reading value",
        undefined,
        422,
      );
    }

    const { data: batch, error: batchError } = await supabase
      .from("batches")
      .select("id, batch_code, status")
      .eq("id", batchId)
      .single();
    if (batchError || !batch) {
      return errorResponse("NOT_FOUND", "Batch not found", undefined, 404);
    }

    if (
      !READING_ELIGIBLE_STATES.includes(
        batch.status as (typeof READING_ELIGIBLE_STATES)[number],
      )
    ) {
      return errorResponse(
        "CONFLICT",
        `Batch #${batch.batch_code} is "${batch.status}" — readings can only be added while it is ${READING_ELIGIBLE_STATES.join(", ")}.`,
        undefined,
        409,
      );
    }

    // Re-stamp the timestamp at execution time rather than trusting the
    // value frozen on the card when the tool proposed the write — a card
    // confirmed hours later shouldn't backdate the reading.
    const { error: insertError } = await supabase.from("batch_logs").insert({
      batch_id: batch.id,
      log_type: "measurement",
      data: { ...reading, timestamp: new Date().toISOString() },
    });
    if (insertError) {
      // Maps RLS denials (42501) to a friendly FORBIDDEN via PG_ERROR_MAP.
      const apiError = handleApiError(insertError);
      return errorResponse(
        apiError.code,
        apiError.message,
        apiError.details,
        apiError.status,
      );
    }

    return successResponse({ saved: true, batchCode: batch.batch_code });
  },
);
