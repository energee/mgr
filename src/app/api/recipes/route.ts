import { z } from "zod";
import { paginatedResponse } from "@/lib/api/response";
import { withPermission } from "@/lib/api/auth";
import { validateBody, validateSearchParams } from "@/lib/api/validation";
import { recipeSchema } from "@/lib/schemas/recipe";
import { successResponse } from "@/lib/api/response";
import { escapeIlikePattern } from "@/lib/supabase/query-helpers";
import { unwrap } from "@/lib/supabase/query-helpers";

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

export const GET = withPermission("recipes:read", async (request, { supabase }) => {
  const {
    page = 1,
    per_page = 25,
    brand_id,
    style_id,
    is_active,
    sort = "name",
    direction = "asc",
    search,
  } = validateSearchParams(listParamsSchema, request);

  let query = supabase
    .from("recipes_with_estimates")
    .select("*", { count: "exact" });

  if (brand_id) query = query.eq("brand_id", brand_id);
  if (style_id) query = query.eq("style_id", style_id);
  if (is_active !== undefined) query = query.eq("is_active", is_active === "true");
  if (search) {
    // Strip PostgREST filter metacharacters, then escape LIKE wildcards
    // so user input like "%" or "_" matches literally.
    const sanitized = escapeIlikePattern(search.replace(/[.,()\\]/g, ""));
    query = query.ilike("name", `%${sanitized}%`);
  }

  query = query
    .order(sort, { ascending: direction === "asc" })
    .range((page - 1) * per_page, page * per_page - 1);

  const { data, error, count } = await query;
  if (error) throw error;

  return paginatedResponse(data ?? [], page, per_page, count ?? 0);
});

export const POST = withPermission("recipes:write", async (request, { supabase }) => {
  const body = await validateBody(recipeSchema, request);

  return successResponse(
    await unwrap(supabase.from("recipes").insert(body).select().single()),
    undefined,
    201
  );
});
