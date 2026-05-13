/**
 * Auth Callback Route
 *
 * Handles the callback from magic-link, OAuth, and password-recovery emails.
 * Exchanges the auth code for a session, then forwards the user to
 * /update-password for `type=recovery`, or to the requested redirect otherwise.
 *
 * CSRF posture (audit F-128): Supabase's `exchangeCodeForSession` uses the
 * PKCE flow under the hood — the SDK stores a `code_verifier` in an
 * httpOnly cookie at sign-in initiation and validates it server-side here.
 * That binding is browser-session-scoped, which provides equivalent CSRF
 * protection to an explicit `state` parameter. The redirect parameter is
 * additionally allow-list-validated by `isValidRedirect` to prevent open
 * redirects to attacker-controlled domains.
 *
 * Failures are logged via `logger.error` (which forwards to Sentry per
 * F-147) so any anomalous callback activity is observable.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isValidRedirect } from "@/lib/auth-utils";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const type = searchParams.get("type");
  const rawRedirect = searchParams.get("redirect") || "/";

  // Validate redirect parameter to prevent open redirect attacks.
  // Allow-list-driven; falls back to "/" if the value is suspicious.
  const safeRedirect = isValidRedirect(rawRedirect) ? rawRedirect : "/";

  if (!code) {
    logger.warn(
      { rawRedirect },
      "[Auth Callback] Missing code parameter — redirecting to login",
    );
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  // Basic shape guard before handing off to the SDK. The SDK already
  // rejects malformed codes, but failing fast here makes log analysis
  // easier when an unknown user-agent is probing the endpoint.
  if (code.length > 256 || !/^[A-Za-z0-9._~+/=-]+$/.test(code)) {
    logger.warn(
      { codeLength: code.length },
      "[Auth Callback] Rejected malformed code parameter",
    );
    return NextResponse.redirect(`${origin}/login?error=auth_callback_error`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // exchangeCodeForSession fails if the code is expired, already used, or
    // doesn't match the stored PKCE verifier. Either way: log and bounce.
    logger.error(
      { err: error.message, status: error.status },
      "[Auth Callback] Code exchange failed",
    );
    return NextResponse.redirect(`${origin}/login?error=auth_callback_error`);
  }

  const destination = type === "recovery" ? "/update-password" : safeRedirect;
  return NextResponse.redirect(`${origin}${destination}`);
}
