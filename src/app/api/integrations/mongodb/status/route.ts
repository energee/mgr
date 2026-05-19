/**
 * MongoDB Integration — Connection Status
 *
 * GET: Tests MongoDB connection and returns status + recent sync logs.
 */

import { withPermission } from "@/lib/api/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { testConnection } from "@/integrations/mongodb/client";
import { createAdminClient } from "@/lib/supabase/server";
import { dynamicFrom } from "@/services/types";

export const GET = withPermission("integrations:manage", async () => {
  try {
    // Fetch sync logs first (fast, doesn't depend on MongoDB being reachable)
    const admin = await createAdminClient();
    const { data: recentLogs } = await dynamicFrom(admin, "mongodb_sync_log")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(20);

    // Test connection (may timeout if MongoDB is unreachable)
    const connectionResult = await testConnection();

    return successResponse({
      connected: connectionResult.ok,
      dbName: connectionResult.dbName ?? null,
      error: connectionResult.error ?? null,
      recentLogs: recentLogs ?? [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse("MONGODB_STATUS_ERROR", message, undefined, 500);
  }
});
