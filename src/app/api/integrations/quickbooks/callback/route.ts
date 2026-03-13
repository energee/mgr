/**
 * QuickBooks OAuth - Callback Handler
 *
 * GET: Receives the OAuth callback from Intuit, exchanges the authorization
 * code for tokens, stores them, and redirects to the settings page.
 *
 * This route is NOT wrapped with withAuth because it's called by Intuit's
 * redirect - we verify the user session manually via Supabase cookies.
 */

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { exchangeCodeForTokens, saveTokens } from "@/lib/quickbooks";
import { log } from "@/lib/client-logger";

export async function GET(request: NextRequest): Promise<Response> {
  // Verify user is authenticated via session cookie
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const realmId = searchParams.get("realmId");
  const error = searchParams.get("error");
  const state = searchParams.get("state");

  const settingsUrl = new URL("/settings/integrations", request.url);

  // Validate CSRF state token from cookie
  const cookieStore = await cookies();
  const storedState = cookieStore.get("qbo_oauth_state")?.value;
  cookieStore.delete("qbo_oauth_state");

  if (!state || state !== storedState) {
    settingsUrl.searchParams.set("qbo_error", "Invalid OAuth state");
    return NextResponse.redirect(settingsUrl);
  }

  if (error) {
    settingsUrl.searchParams.set("qbo_error", error);
    return NextResponse.redirect(settingsUrl);
  }

  if (!code || !realmId) {
    settingsUrl.searchParams.set("qbo_error", "Missing code or realmId");
    return NextResponse.redirect(settingsUrl);
  }

  try {
    const redirectUri =
      process.env.NEXT_PUBLIC_QBO_REDIRECT_URI ||
      `${new URL(request.url).origin}/api/integrations/quickbooks/callback`;

    const tokens = await exchangeCodeForTokens(code, redirectUri);
    const expiresAt = new Date(
      Date.now() + tokens.expiresIn * 1000
    ).toISOString();

    await saveTokens({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      realmId,
      expiresAt,
    });

    settingsUrl.searchParams.set("qbo_connected", "true");
    return NextResponse.redirect(settingsUrl);
  } catch (err) {
    log.error("[QBO Callback] Token exchange failed:", err);
    settingsUrl.searchParams.set("qbo_error", "Token exchange failed");
    return NextResponse.redirect(settingsUrl);
  }
}
