/**
 * POST /api/batches/[id]/transfer — transition a batch to a new status.
 *
 * Validates the target against batchTransitions, then submits one atomic
 * transition command. The state change and all database side effects commit
 * together or roll back together.
 */
import { z } from "zod";
import { successResponse, errorResponse } from "@/lib/api/response";
import { withPermission } from "@/lib/api/auth";
import { validateBody } from "@/lib/api/validation";
import { ApiError } from "@/lib/api/errors";
import { batchStates, batchTransitions } from "@/lib/schemas/batch";
import { batchCore as batchCoreInput } from "@/entities/batch/core";
import { resolveServerCore } from "@/types/entity";
import { entityService } from "@/services/entity-service";
import { formatServiceError } from "@/services/types";

const transitionSchema = z.object({
  to_status: z.enum(batchStates),
});
const batchCore = resolveServerCore(batchCoreInput);

export const POST = withPermission("batches:write", async (request, { supabase, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("VALIDATION_ERROR", "Batch ID required", undefined, 400);

  const { to_status } = await validateBody(transitionSchema, request);

  const { data: batch, error: fetchError } = await supabase
    .from("batches")
    .select("id, status")
    .eq("id", id)
    .single();

  if (fetchError || !batch) {
    return errorResponse("NOT_FOUND", "Batch not found", undefined, 404);
  }

  const allowed = batchTransitions[batch.status] ?? [];
  if (!allowed.includes(to_status)) {
    throw new ApiError(
      "VALIDATION_ERROR",
      `Cannot transition from "${batch.status}" to "${to_status}". Allowed: ${allowed.join(", ") || "none"}`,
      422
    );
  }

  const result = await entityService.transition(
    supabase,
    batchCore,
    id,
    to_status
  );
  if (!result.success) {
    const conflict = result.error.code === "INVALID_TRANSITION";
    throw new ApiError(
      conflict ? "CONFLICT" : "INTERNAL_ERROR",
      formatServiceError(result.error),
      conflict ? 409 : 500
    );
  }

  return successResponse(result.data);
});
