import { z } from "zod";
import {
  withAuth,
  successResponse,
  errorResponse,
  validateBody,
  ApiError,
} from "@/lib/api";

const transitionSchema = z.object({
  to_status: z.enum([
    "planned",
    "fermenting",
    "conditioning",
    "packaging",
    "completed",
    "cancelled",
    "archived",
  ]),
});

const VALID_TRANSITIONS: Record<string, string[]> = {
  planned: ["fermenting"],
  fermenting: ["conditioning"],
  conditioning: ["packaging"],
  packaging: ["completed"],
  completed: [],
  cancelled: [],
  archived: [],
};

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

  const allowed = VALID_TRANSITIONS[batch.status] ?? [];
  if (!allowed.includes(to_status)) {
    throw new ApiError(
      "VALIDATION_ERROR",
      `Cannot transition from "${batch.status}" to "${to_status}". Allowed: ${allowed.join(", ") || "none"}`,
      422
    );
  }

  const { data, error } = await supabase
    .from("batches")
    .update({ status: to_status })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;

  return successResponse(data);
});
