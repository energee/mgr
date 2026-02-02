import { z } from "zod";
import {
  withAuth,
  successResponse,
  errorResponse,
  validateBody,
  ApiError,
} from "@/lib/api";
import { batchStates, batchTransitions } from "@/lib/schemas/batch";

const transitionSchema = z.object({
  to_status: z.enum(batchStates),
});

export const POST = withAuth(async (request, { supabase, params }) => {
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

  return successResponse(data);
});
