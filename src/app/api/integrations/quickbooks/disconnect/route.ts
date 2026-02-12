/**
 * QuickBooks OAuth - Disconnect
 *
 * POST: Revokes the OAuth token with Intuit and clears stored credentials.
 * Always clears local tokens even if the remote revoke call fails.
 */

import { withAuth } from "@/lib/api/auth";
import { successResponse } from "@/lib/api/response";
import { revokeToken, clearTokens } from "@/lib/quickbooks";

export const POST = withAuth(async () => {
  try {
    await revokeToken();
    await clearTokens();
    return successResponse({ disconnected: true });
  } catch (err) {
    console.error("[QBO Disconnect] Error:", err);
    // Still clear tokens even if revoke fails
    await clearTokens();
    return successResponse({ disconnected: true, revokeError: true });
  }
});
