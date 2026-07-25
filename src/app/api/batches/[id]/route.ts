import {
  withPermission,
  successResponse,
  errorResponse,
  validateBody,
} from "@/lib/api";
import { batchUpdateSchema } from "@/lib/schemas/batch";

export const GET = withPermission("batches:read", async (request, { supabase, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("VALIDATION_ERROR", "Batch ID required", undefined, 400);

  const { data, error } = await supabase
    .from("batches_with_brew_info")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return errorResponse("NOT_FOUND", "Batch not found", undefined, 404);
    }
    throw error;
  }

  return successResponse(data);
});

/**
 * Field-update surface only. A batch state change must go through
 * `POST /api/batches/[id]/transfer`, which runs `transition_entity_atomic` so
 * the status write and its side effects (vessel release, ingredient-allocation
 * completion, loss reconciliation) commit or roll back together.
 */
export const PATCH = withPermission("batches:write", async (request, { supabase, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("VALIDATION_ERROR", "Batch ID required", undefined, 400);

  // Read the raw payload to tell a caller-supplied `status` apart from the
  // schema's own default, then reject rather than silently dropping it — an
  // explicit 400 tells an integrator its state change did not happen.
  const submitted: unknown = await request.clone().json().catch(() => null);
  if (submitted !== null && typeof submitted === "object" && "status" in submitted) {
    return errorResponse(
      "VALIDATION_ERROR",
      "Batch status cannot be changed here. Use POST /api/batches/[id]/transfer, " +
        "which runs the atomic transition and its side effects.",
      undefined,
      400
    );
  }

  const body = await validateBody(batchUpdateSchema, request);

  const { data, error } = await supabase
    .from("batches")
    .update(body)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return errorResponse("NOT_FOUND", "Batch not found", undefined, 404);
    }
    throw error;
  }

  return successResponse(data);
});

export const DELETE = withPermission("batches:write", async (request, { supabase, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("VALIDATION_ERROR", "Batch ID required", undefined, 400);

  const { error } = await supabase
    .from("batches")
    .delete()
    .eq("id", id);

  if (error) {
    if (error.code === "PGRST116") {
      return errorResponse("NOT_FOUND", "Batch not found", undefined, 404);
    }
    throw error;
  }

  return successResponse(null, undefined, 204);
});
