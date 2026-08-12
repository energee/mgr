import { successResponse, errorResponse } from "@/lib/api/response";
import { withPermission } from "@/lib/api/auth";
import { validateBody } from "@/lib/api/validation";
import { recipeUpdateSchema } from "@/lib/schemas/recipe";

export const GET = withPermission("recipes:read", async (request, { supabase, params }) => {
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

export const PATCH = withPermission("recipes:write", async (request, { supabase, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("VALIDATION_ERROR", "Recipe ID required", undefined, 400);

  const body = await validateBody(recipeUpdateSchema, request);

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

export const DELETE = withPermission("recipes:write", async (request, { supabase, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("VALIDATION_ERROR", "Recipe ID required", undefined, 400);

  // Check for associated batches
  const { count, error: countError } = await supabase
    .from("batches")
    .select("id", { count: "exact", head: true })
    .eq("recipe_id", id);

  if (countError) throw countError;

  if (count && count > 0) {
    return errorResponse(
      "CONFLICT",
      `Cannot delete recipe that is associated with ${count} batch${count === 1 ? "" : "es"}`,
      undefined,
      409
    );
  }

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
