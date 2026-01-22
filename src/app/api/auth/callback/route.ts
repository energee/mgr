/**
 * Auth Callback Route
 *
 * Handles the callback from magic link authentication.
 * Exchanges the auth code for a session and redirects.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Validates that a redirect path is safe (relative path only).
 * Prevents open redirect vulnerabilities.
 */
function isValidRedirect(path: string): boolean {
  // Must be relative path, no protocol, no double slashes
  return (
    path.startsWith("/") &&
    !path.startsWith("//") &&
    !path.includes("://")
  );
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const redirect = searchParams.get("redirect") || "/";

  // Validate redirect parameter to prevent open redirect attacks
  const safeRedirect = isValidRedirect(redirect) ? redirect : "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(`${origin}${safeRedirect}`);
    }
  }

  // If there's an error, redirect to login with error
  return NextResponse.redirect(`${origin}/login?error=auth_callback_error`);
}
