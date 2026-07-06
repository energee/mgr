/**
 * POST /api/batches/[id]/transfer — transition a batch to a new status.
 *
 * Validates the target against batchTransitions, applies an optimistic-locked
 * UPDATE, then runs the central transition side-effect registry (e.g.
 * batches → completed confirms planned ingredient consumption). Response is
 * the updated batch row plus a `side_effects` summary; a side-effect failure
 * does not roll back the transition (mirrors the UI transition paths).
 */
import { z } from "zod";
import {
  withPermission,
  successResponse,
  errorResponse,
  validateBody,
  ApiError,
} from "@/lib/api";
import { batchStates, batchTransitions } from "@/lib/schemas/batch";
import { runTransitionSideEffects } from "@/services/transition-side-effects";

const transitionSchema = z.object({
  to_status: z.enum(batchStates),
});

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

  // Optimistic lock: only update if status hasn't changed since we read it
  const { data, error } = await supabase
    .from("batches")
    .update({ status: to_status })
    .eq("id", id)
    .eq("status", batch.status)
    .select()
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      throw new ApiError(
        "CONFLICT",
        "Batch status was modified concurrently. Please refresh and try again.",
        409
      );
    }
    throw error;
  }

  // Post-transition side effects (registry: src/services/transition-side-effects.ts).
  // Never throws; failures surface in the response instead of silently skipping.
  const sideEffects = await runTransitionSideEffects(supabase, "batches", [id], to_status);

  return successResponse({
    ...data,
    side_effects: {
      error: sideEffects.error,
      completed_allocations: sideEffects.completedAllocations,
    },
  });
});
