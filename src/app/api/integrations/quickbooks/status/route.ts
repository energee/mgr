/**
 * QuickBooks OAuth - Connection Status
 *
 * GET: Checks whether QuickBooks is connected and returns company info + auto_sync_enabled.
 * POST: Toggles the auto-sync setting in system_settings.
 */

import { withAuth } from "@/lib/api/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { getTokens, getAutoSyncEnabled, qboClient } from "@/lib/quickbooks";
import { createAdminClient } from "@/lib/supabase/server";
import type { QBOCompanyInfo, QBOQueryResponse } from "@/lib/quickbooks";

export const GET = withAuth(async () => {
  const tokens = await getTokens();
  const autoSyncEnabled = await getAutoSyncEnabled();

  if (!tokens) {
    return successResponse({ connected: false, autoSyncEnabled });
  }

  try {
    // Fetch company info to verify the connection is still valid
    const result = await qboClient.query<QBOQueryResponse<QBOCompanyInfo>>(
      "CompanyInfo"
    );

    const companyInfo = result?.QueryResponse?.CompanyInfo?.[0];

    return successResponse({
      connected: true,
      companyName: companyInfo?.CompanyName || "Unknown",
      realmId: tokens.realmId,
      environment: tokens.environment,
      autoSyncEnabled,
    });
  } catch {
    // Token might be expired but we still have credentials
    return successResponse({
      connected: true,
      companyName: null,
      realmId: tokens.realmId,
      environment: tokens.environment,
      tokenError: true,
      autoSyncEnabled,
    });
  }
});

export const POST = withAuth(async (request) => {
  const body = await request.json();
  const { auto_sync_enabled } = body;

  if (typeof auto_sync_enabled !== "boolean") {
    return errorResponse(
      "INVALID_INPUT",
      "auto_sync_enabled must be a boolean",
      undefined,
      400
    );
  }

  const admin = await createAdminClient();
  const { error } = await admin
    .from("system_settings")
    .upsert(
      { key: "qbo_auto_sync_enabled", value: String(auto_sync_enabled) },
      { onConflict: "key" }
    );

  if (error) {
    return errorResponse(
      "DB_ERROR",
      `Failed to update auto-sync setting: ${error.message}`,
      undefined,
      500
    );
  }

  return successResponse({ autoSyncEnabled: auto_sync_enabled });
});
