/**
 * GET /api/auth/confirm
 *
 * Exchanges a Supabase email token hash for a cookie-backed SSR session, then
 * redirects to the same-origin destination supplied when the email was sent.
 * The hosted Magic Link template points here instead of using
 * `.ConfirmationURL`, whose implicit-flow session fragment is invisible to a
 * server callback.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isValidRedirect } from "@/lib/auth-utils";
import { logger } from "@/lib/logger";

const log = logger.child({ route: "/api/auth/confirm" });

function safeDestination(rawRedirect: string | null, origin: string): string {
  if (!rawRedirect) return `${origin}/`;

  try {
    const destination = new URL(rawRedirect, origin);
    const path = `${destination.pathname}${destination.search}`;
    if (destination.origin !== origin || !isValidRedirect(path)) {
      return `${origin}/`;
    }
    return `${origin}${path}`;
  } catch {
    return `${origin}/`;
  }
}

function failureDestination(destination: string, origin: string): string {
  return new URL(destination).pathname.startsWith("/portal")
    ? `${origin}/portal/login?error=confirmation_failed`
    : `${origin}/login?error=confirmation_failed`;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const destination = safeDestination(searchParams.get("redirect_to"), origin);

  if (!tokenHash || tokenHash.length > 1024 || type !== "email") {
    log.warn(
      { hasTokenHash: !!tokenHash, type },
      "Email confirmation rejected invalid parameters",
    );
    return NextResponse.redirect(`${origin}/login?error=invalid_confirmation`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "email",
  });

  if (error) {
    log.warn(
      { err: error.message, status: error.status },
      "Email token confirmation failed",
    );
    return NextResponse.redirect(failureDestination(destination, origin));
  }

  return NextResponse.redirect(destination);
}
