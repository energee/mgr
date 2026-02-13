/**
 * QuickBooks OAuth - Auth URL Generator
 *
 * GET: Returns an OAuth authorization URL for the frontend to open.
 * Does not redirect directly - the frontend controls the flow.
 */

import { withAuth } from "@/lib/api/auth";
import { errorResponse, successResponse } from "@/lib/api/response";
import { getClientCredentials } from "@/lib/quickbooks";

const QBO_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const SCOPES = "com.intuit.quickbooks.accounting";

export const GET = withAuth(async (request) => {
  const creds = await getClientCredentials();
  if (!creds) {
    return errorResponse(
      "VALIDATION_ERROR",
      "QuickBooks client credentials not configured",
      undefined,
      400
    );
  }

  const redirectUri =
    process.env.NEXT_PUBLIC_QBO_REDIRECT_URI ||
    `${new URL(request.url).origin}/api/integrations/quickbooks/callback`;

  const params = new URLSearchParams({
    client_id: creds.clientId,
    response_type: "code",
    scope: SCOPES,
    redirect_uri: redirectUri,
    state: crypto.randomUUID(), // CSRF protection
  });

  return successResponse({ url: `${QBO_AUTH_URL}?${params.toString()}` });
});
