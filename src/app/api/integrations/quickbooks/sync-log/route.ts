/**
 * QuickBooks Sync Log
 *
 * GET: Query sync log with optional filters.
 * Query params: entityType, entityId, status, limit, offset
 *
 * Responses: 200 `{ logs, total }` on success (including a genuinely empty
 * result), 500 `DB_ERROR` when the read fails. A failed read must never be
 * reported as an empty log — consumers would render an already-synced entity
 * as "Not Synced" and the outage would look like an empty table.
 */

import { withPermission } from "@/lib/api/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

export const GET = withPermission("integrations:manage", async (request) => {
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
    logger.error(
      { err: error.message, entityType, entityId, status },
      "Failed to read qbo_sync_log"
    );
    return errorResponse(
      "DB_ERROR",
      `Failed to read sync log: ${error.message}`,
      undefined,
      500
    );
  }

  return successResponse({ logs: data || [], total: count || 0 });
});
