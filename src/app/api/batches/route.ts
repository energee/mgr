import { z } from "zod";
import {
  withAuth,
  paginatedResponse,
  validateBody,
  validateSearchParams,
} from "@/lib/api";
import { batchSchema } from "@/lib/schemas/batch";
import { successResponse } from "@/lib/api/response";

const listParamsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(25),
  status: z.string().optional(),
  recipe_id: z.string().uuid().optional(),
  sort: z.string().default("created_at"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  search: z.string().optional(),
});

export const GET = withAuth(async (request, { supabase }) => {
  const {
    page = 1,
    per_page = 25,
    status,
    recipe_id,
    sort = "created_at",
    direction = "desc",
    search,
  } = validateSearchParams(listParamsSchema, request);

  let query = supabase
    .from("batches_with_brew_info")
    .select("*", { count: "exact" });

  if (status) {
    query = query.eq("status", status);
  }
  if (recipe_id) {
    query = query.eq("recipe_id", recipe_id);
  }
  if (search) {
    // Strip PostgREST filter metacharacters (dots, commas, parens, backslashes)
    // to prevent filter injection via the .or() string
    const sanitized = search.replace(/[.,()\\]/g, "");
    query = query.or(`batch_number.ilike.%${sanitized}%,name.ilike.%${sanitized}%`);
  }

  query = query
    .order(sort, { ascending: direction === "asc" })
    .range((page - 1) * per_page, page * per_page - 1);

  const { data, error, count } = await query;

  if (error) throw error;

  return paginatedResponse(data ?? [], page, per_page, count ?? 0);
});

export const POST = withAuth(async (request, { supabase }) => {
  const body = await validateBody(batchSchema, request);

  const { data, error } = await supabase
    .from("batches")
    .insert(body)
    .select()
    .single();

  if (error) throw error;

  return successResponse(data, undefined, 201);
});
