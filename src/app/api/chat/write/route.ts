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
import { READING_TYPES, validateReading } from "@/domain/batch-readings";
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

    if (!READING_TYPES[reading.reading_type].units.includes(reading.unit)) {
      return errorResponse(
        "VALIDATION_ERROR",
        `Invalid unit "${reading.unit}" for ${READING_TYPES[reading.reading_type].label}`,
        undefined,
        422,
      );
    }

    const validation = validateReading(reading.reading_type, reading.value);
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

    const { error: insertError } = await supabase.from("batch_logs").insert({
      batch_id: batch.id,
      log_type: "measurement",
      data: reading,
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
