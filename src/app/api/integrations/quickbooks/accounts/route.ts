/**
 * QuickBooks Accounts - Chart of Accounts & Mappings
 *
 * GET: Fetch QBO chart of accounts and current mappings.
 * PUT: Save account mappings.
 */

import { withPermission } from "@/lib/api/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/server";
import { qboClient, getTokens } from "@/lib/quickbooks";
import type { QBOAccount, QBOQueryResponse } from "@/lib/quickbooks";

export const GET = withPermission("integrations:manage", async () => {
  const tokens = await getTokens();
  if (!tokens) {
    return errorResponse(
      "VALIDATION_ERROR",
      "QuickBooks not connected",
      undefined,
      400
    );
  }

  try {
    const result = await qboClient.query<QBOQueryResponse<QBOAccount>>(
      "Account",
      "Active = true"
    );
    const accounts = result?.QueryResponse?.Account || [];

    const admin = await createAdminClient();
    const { data: mappings } = await admin
      .from("qbo_account_mappings")
      .select("*");

    return successResponse({ accounts, mappings: mappings || [] });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch accounts";
    return errorResponse("INTERNAL_ERROR", message, undefined, 500);
  }
});

export const PUT = withPermission("integrations:manage", async (request) => {
  const { mappings } = (await request.json()) as {
    mappings: {
      category: string;
      qbo_account_id: string;
      qbo_account_name: string;
    }[];
  };

  if (!mappings?.length) {
    return errorResponse(
      "VALIDATION_ERROR",
      "mappings[] is required",
      undefined,
      400
    );
  }

  const admin = await createAdminClient();

  const { error } = await admin
    .from("qbo_account_mappings")
    .upsert(
      mappings.map((m) => ({
        category: m.category,
        qbo_account_id: m.qbo_account_id,
        qbo_account_name: m.qbo_account_name,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "category" }
    );

  if (error) {
    return errorResponse("DB_ERROR", `Failed to save mappings: ${error.message}`, undefined, 500);
  }

  return successResponse({ updated: mappings.length });
});
