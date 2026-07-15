/**
 * QuickBooks OAuth - Auth URL Generator
 *
 * GET: Returns an OAuth authorization URL for the frontend to open.
 * Does not redirect directly - the frontend controls the flow.
 */

import { cookies } from "next/headers";
import { withPermission } from "@/lib/api/auth";
import { errorResponse, successResponse } from "@/lib/api/response";
import { getClientCredentials } from "@/integrations/quickbooks";

const QBO_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const SCOPES = "com.intuit.quickbooks.accounting";

export const GET = withPermission("integrations:manage", async (request, { user }) => {
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

  const state = crypto.randomUUID();

  // Store state in httpOnly cookie for CSRF validation in the callback
  const cookieStore = await cookies();
  cookieStore.set("qbo_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/api/integrations/quickbooks",
  });
  cookieStore.set("qbo_oauth_initiator", user.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // Match the state cookie lifetime
    path: "/api/integrations/quickbooks",
  });

  const params = new URLSearchParams({
    client_id: creds.clientId,
    response_type: "code",
    scope: SCOPES,
    redirect_uri: redirectUri,
    state,
  });

  return successResponse({ url: `${QBO_AUTH_URL}?${params.toString()}` });
});
