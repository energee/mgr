import { z } from "zod";
import {
  withAuth,
  paginatedResponse,
  validateBody,
  validateSearchParams,
} from "@/lib/api";
import { recipeSchema } from "@/entities/recipe";
import { successResponse } from "@/lib/api/response";

const listParamsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(25),
  brand_id: z.string().uuid().optional(),
  style_id: z.string().uuid().optional(),
  is_active: z.enum(["true", "false"]).optional(),
  sort: z.string().default("name"),
  direction: z.enum(["asc", "desc"]).default("asc"),
  search: z.string().optional(),
});

export const GET = withAuth(async (request, { supabase }) => {
  const params = validateSearchParams(listParamsSchema, request);
  const {
    page = 1,
    per_page = 25,
    brand_id,
    style_id,
    is_active,
    sort = "name",
    direction = "asc",
    search,
  } = params;

  let query = supabase
    .from("recipes_with_estimates")
    .select("*", { count: "exact" });

  if (brand_id) query = query.eq("brand_id", brand_id);
  if (style_id) query = query.eq("style_id", style_id);
  if (is_active !== undefined) query = query.eq("is_active", is_active === "true");
  if (search) query = query.ilike("name", `%${search}%`);

  query = query
    .order(sort, { ascending: direction === "asc" })
    .range((page - 1) * per_page, page * per_page - 1);

  const { data, error, count } = await query;
  if (error) throw error;

  return paginatedResponse(data ?? [], page, per_page, count ?? 0);
});

export const POST = withAuth(async (request, { supabase }) => {
  const body = await validateBody(recipeSchema, request);

  const { data, error } = await supabase
    .from("recipes")
    .insert(body)
    .select()
    .single();

  if (error) throw error;

  return successResponse(data, undefined, 201);
});
