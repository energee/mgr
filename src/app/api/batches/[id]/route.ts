import {
  withAuth,
  successResponse,
  errorResponse,
  validateBody,
} from "@/lib/api";
import { batchSchema } from "@/lib/schemas/batch";

export const GET = withAuth(async (request, { supabase, params }) => {
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

export const PATCH = withAuth(async (request, { supabase, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("VALIDATION_ERROR", "Batch ID required", undefined, 400);

  const body = await validateBody(batchSchema.partial(), request);

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

export const DELETE = withAuth(async (request, { supabase, params }) => {
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
