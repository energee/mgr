/**
 * QuickBooks Sync Log
 *
 * GET: Query sync log with optional filters.
 * Query params: entityType, entityId, status, limit, offset
 */

import { withAuth } from "@/lib/api/auth";
import { successResponse } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/server";

export const GET = withAuth(async (request) => {
  const { searchParams } = new URL(request.url);
  const entityType = searchParams.get("entityType");
  const entityId = searchParams.get("entityId");
  const status = searchParams.get("status");
  const limit = parseInt(searchParams.get("limit") || "20", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  const admin = await createAdminClient();
  let query = admin
    .from("qbo_sync_log")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (entityType) query = query.eq("entity_type", entityType);
  if (entityId) query = query.eq("entity_id", entityId);
  if (status) query = query.eq("status", status);

  const { data, error, count } = await query;

  if (error) {
    return successResponse({ logs: [], total: 0 });
  }

  return successResponse({ logs: data || [], total: count || 0 });
});
