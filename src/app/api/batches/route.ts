import { z } from "zod";
import { paginatedResponse } from "@/lib/api/response";
import { withPermission } from "@/lib/api/auth";
import { validateBody, validateSearchParams } from "@/lib/api/validation";
import { batchSchema } from "@/lib/schemas/batch";
import { successResponse } from "@/lib/api/response";
import { escapeIlikePattern } from "@/lib/supabase/query-helpers";
import { unwrap } from "@/lib/supabase/query-helpers";

const listParamsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(25),
  status: z.string().optional(),
  recipe_id: z.string().uuid().optional(),
  sort: z.string().default("created_at"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  search: z.string().optional(),
});

export const GET = withPermission("batches:read", async (request, { supabase }) => {
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
    // to prevent filter injection via the .or() string, then escape LIKE
    // wildcards so user input like "%" or "_" matches literally.
    const sanitized = escapeIlikePattern(search.replace(/[.,()\\]/g, ""));
    query = query.or(`batch_code.ilike.%${sanitized}%,name.ilike.%${sanitized}%`);
  }

  query = query
    .order(sort, { ascending: direction === "asc" })
    .range((page - 1) * per_page, page * per_page - 1);

  const { data, error, count } = await query;

  if (error) throw error;

  return paginatedResponse(data ?? [], page, per_page, count ?? 0);
});

export const POST = withPermission("batches:write", async (request, { supabase }) => {
  const body = await validateBody(batchSchema, request);

  // Omit batch_code if not provided — DB trigger auto-generates it
  const { batch_code, ...rest } = body;
  const insertPayload = batch_code ? { ...rest, batch_code } : rest;

  return successResponse(
    await unwrap(supabase.from("batches").insert(insertPayload).select().single()),
    undefined,
    201
  );
});
