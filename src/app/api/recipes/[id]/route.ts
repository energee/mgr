import {
  withAuth,
  successResponse,
  errorResponse,
  validateBody,
} from "@/lib/api";
import { recipeSchema } from "@/entities/recipe";

export const GET = withAuth(async (request, { supabase, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("VALIDATION_ERROR", "Recipe ID required", undefined, 400);

  const { data, error } = await supabase
    .from("recipes_with_estimates")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return errorResponse("NOT_FOUND", "Recipe not found", undefined, 404);
    }
    throw error;
  }

  return successResponse(data);
});

export const PATCH = withAuth(async (request, { supabase, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("VALIDATION_ERROR", "Recipe ID required", undefined, 400);

  const body = await validateBody(recipeSchema.partial(), request);

  const { data, error } = await supabase
    .from("recipes")
    .update(body)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return errorResponse("NOT_FOUND", "Recipe not found", undefined, 404);
    }
    throw error;
  }

  return successResponse(data);
});

export const DELETE = withAuth(async (request, { supabase, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("VALIDATION_ERROR", "Recipe ID required", undefined, 400);

  const { error } = await supabase
    .from("recipes")
    .delete()
    .eq("id", id);

  if (error) {
    if (error.code === "PGRST116") {
      return errorResponse("NOT_FOUND", "Recipe not found", undefined, 404);
    }
    throw error;
  }

  return successResponse(null, undefined, 204);
});
