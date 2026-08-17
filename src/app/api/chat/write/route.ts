/**
 * Confirm-gated AI chat write endpoint (Phase 4C, extended in Phase 4B).
 *
 * Executes a write the user explicitly confirmed on a chat action card.
 * Chat tools only *propose* writes (the confirm-gated tools in `../tools.ts`);
 * nothing is persisted until the client POSTs the pending payload here. The
 * payload is re-validated with `chatWriteRequestSchema` and executed with the
 * caller's session Supabase client, so RLS — not this route — is the final
 * authority.
 *
 * Authorization is resolved *per write action*: the request is authenticated
 * with `withAuth`, the payload is parsed, and only then is the action's own
 * permission enforced via `requirePermission` + `CHAT_WRITE_PERMISSIONS`.
 * A blanket `withPermission(...)` wrapper would gate every present and future
 * write on one permission regardless of what it touches.
 *
 * Writes gated here today:
 * - `add_batch_reading`        → inserts a `batch_logs` measurement
 * - `transition_batch`         → `entityService.transition` (the
 *   `transition_entity_atomic` RPC, so registered side effects commit with
 *   the state change — never a bare status UPDATE)
 * - `create_packaging_session` → inserts a `planned` packaging session
 * - `create_batch`             → inserts a `planned` batch from a recipe
 *
 * Add new writes as a union member in `src/lib/schemas/chat-write.ts`, an
 * entry in `CHAT_WRITE_PERMISSIONS`, and a case below.
 */

// tx-ok: the awaited mutations in this file are mutually exclusive switch
// branches, not a sequence — exactly one runs per request, and each is a
// single-statement write. The one write with side effects (transition_batch)
// delegates to the transition_entity_atomic RPC rather than writing directly.

import type { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { withAuth, requirePermission } from "@/lib/api/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { handleApiError } from "@/lib/api/errors";
import { READING_TYPES, validateReading } from "@/domain/batch-readings";
import {
  chatWriteRequestSchema,
  CHAT_WRITE_PERMISSIONS,
  READING_ELIGIBLE_STATES,
  type ChatWriteRequest,
} from "@/lib/schemas/chat-write";
import { batchSchema, batchTransitions } from "@/lib/schemas/batch";
import { batchCore as batchCoreInput } from "@/entities/batch/core";
import { packagingSessionSchema } from "@/entities/packaging-session/core";
import { resolveServerCore } from "@/types/entity";
import { entityService } from "@/services/entity-service";
import { formatServiceError } from "@/services/types";
import type { ServiceError } from "@/services/types";

const batchCore = resolveServerCore(batchCoreInput);

type Params<A extends ChatWriteRequest["writeAction"]> = Extract<
  ChatWriteRequest,
  { writeAction: A }
>["params"];

type Client = SupabaseClient<Database>;

/** Map a Supabase write error (RLS denial, FK violation, …) to a response. */
function writeError(error: unknown): NextResponse {
  const apiError = handleApiError(error);
  return errorResponse(
    apiError.code,
    apiError.message,
    apiError.details,
    apiError.status,
  );
}

/** Map a `ServiceResult` failure to the closest HTTP status. */
function serviceError(error: ServiceError): NextResponse {
  const status =
    error.code === "INVALID_TRANSITION" || error.code === "CONFLICT"
      ? 409
      : error.code === "NOT_FOUND"
        ? 404
        : error.code === "RLS_DENIED"
          ? 403
          : error.code === "VALIDATION"
            ? 422
            : 500;
  return errorResponse(
    error.code === "RLS_DENIED" ? "FORBIDDEN" : error.code,
    formatServiceError(error),
    undefined,
    status,
  );
}

// =============================================================================
// Per-action handlers
// =============================================================================

async function addBatchReading(
  supabase: Client,
  { batchId, reading }: Params<"add_batch_reading">,
): Promise<NextResponse> {
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
  // Maps RLS denials (42501) to a friendly FORBIDDEN via PG_ERROR_TABLE.
  if (insertError) return writeError(insertError);

  return successResponse({ saved: true, batchCode: batch.batch_code });
}

async function transitionBatch(
  supabase: Client,
  { batchId, toState }: Params<"transition_batch">,
): Promise<NextResponse> {
  const { data: batch, error: batchError } = await supabase
    .from("batches")
    .select("id, batch_code, status")
    .eq("id", batchId)
    .single();
  if (batchError || !batch) {
    return errorResponse("NOT_FOUND", "Batch not found", undefined, 404);
  }

  // Cheap pre-check for a friendly message; entityService.transition
  // re-validates against the state machine under the row lock.
  const allowed = batchTransitions[batch.status] ?? [];
  if (!allowed.includes(toState)) {
    return errorResponse(
      "CONFLICT",
      `Batch #${batch.batch_code} is "${batch.status}" — it cannot move to "${toState}". Allowed: ${allowed.join(", ") || "none"}.`,
      undefined,
      409,
    );
  }

  // One atomic RPC owns the state change and every registered side effect.
  const result = await entityService.transition(
    supabase,
    batchCore,
    batch.id,
    toState,
  );
  if (!result.success) return serviceError(result.error);

  return successResponse({
    saved: true,
    batchCode: batch.batch_code,
    status: toState,
    url: `/production/batches/${batch.id}`,
  });
}

async function createPackagingSession(
  supabase: Client,
  { sessionDate, notes }: Params<"create_packaging_session">,
): Promise<NextResponse> {
  // Re-validate through the entity's own form schema so the chat path and the
  // packaging form cannot drift apart.
  const parsed = packagingSessionSchema.safeParse({
    session_date: sessionDate,
    status: "planned",
    ...(notes ? { notes } : {}),
  });
  if (!parsed.success) {
    return errorResponse(
      "VALIDATION_ERROR",
      "Invalid packaging session",
      parsed.error.issues,
      422,
    );
  }

  const { data, error } = await supabase
    .from("packaging_sessions")
    .insert(parsed.data)
    .select("id, session_date")
    .single();
  if (error || !data) return writeError(error);

  return successResponse({
    saved: true,
    sessionDate: data.session_date,
    url: `/production/packaging/${data.id}`,
  });
}

async function createBatch(
  supabase: Client,
  { recipeId, name, plannedStartDate, volumeBbl }: Params<"create_batch">,
): Promise<NextResponse> {
  const { data: recipe, error: recipeError } = await supabase
    .from("recipes")
    .select("id")
    .eq("id", recipeId)
    .single();
  if (recipeError || !recipe) {
    return errorResponse("NOT_FOUND", "Recipe not found", undefined, 404);
  }

  const parsed = batchSchema.safeParse({
    name,
    status: "planned",
    recipe_id: recipe.id,
    ...(plannedStartDate ? { planned_start_date: plannedStartDate } : {}),
    ...(volumeBbl !== undefined ? { volume_bbl: volumeBbl } : {}),
  });
  if (!parsed.success) {
    return errorResponse(
      "VALIDATION_ERROR",
      "Invalid batch",
      parsed.error.issues,
      422,
    );
  }

  // batch_code is omitted on purpose — a DB trigger generates it.
  const { batch_code: _generated, ...insertPayload } = parsed.data;
  const { data, error } = await supabase
    .from("batches")
    .insert(insertPayload)
    .select("id, batch_code")
    .single();
  if (error || !data) return writeError(error);

  return successResponse({
    saved: true,
    batchCode: data.batch_code,
    url: `/production/batches/${data.id}`,
  });
}

// =============================================================================
// Route
// =============================================================================

export const POST = withAuth(async (request, { user, supabase }) => {
  const parsed = chatWriteRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return errorResponse(
      "VALIDATION_ERROR",
      "Invalid chat write payload",
      parsed.error.issues,
      422,
    );
  }

  const write = parsed.data;
  // Throws ApiError(FORBIDDEN, 403), which withAuth's catch maps to a response.
  await requirePermission(CHAT_WRITE_PERMISSIONS[write.writeAction], {
    user,
    supabase,
  });

  switch (write.writeAction) {
    case "add_batch_reading":
      return addBatchReading(supabase, write.params);
    case "transition_batch":
      return transitionBatch(supabase, write.params);
    case "create_packaging_session":
      return createPackagingSession(supabase, write.params);
    case "create_batch":
      return createBatch(supabase, write.params);
  }
});
