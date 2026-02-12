/**
 * QuickBooks OAuth - Disconnect
 *
 * POST: Revokes the OAuth token with Intuit and clears stored credentials.
 * Always clears local tokens even if the remote revoke call fails.
 */

import { withAuth } from "@/lib/api/auth";
import { successResponse } from "@/lib/api/response";
import { revokeToken, clearTokens } from "@/lib/quickbooks";
import { createAdminClient } from "@/lib/supabase/server";

// Supabase requires a WHERE clause for deletes; use a nil UUID that will never match a real row
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

async function clearQBOData(): Promise<void> {
  const admin = await createAdminClient();
  await Promise.all([
    clearTokens(),
    admin.from("qbo_account_mappings").delete().neq("id", NIL_UUID),
    admin.from("qbo_sync_mappings").delete().neq("id", NIL_UUID),
  ]);
}

export const POST = withAuth(async () => {
  try {
    await revokeToken();
    await clearQBOData();
    return successResponse({ disconnected: true });
  } catch (err) {
    console.error("[QBO Disconnect] Error:", err);
    // Still clear data even if revoke fails
    await clearQBOData();
    return successResponse({ disconnected: true, revokeError: true });
  }
});
