/**
 * Test Login Route — local development and opt-in E2E only.
 *
 * Creates a test user (if needed), gives it the `admin` role, and signs it in
 * with no credentials supplied by the caller. That is a full admin session, so
 * reachability is deliberately narrow: the route answers only when
 *
 *   1. `E2E_DEV_LOGIN` is exactly `"1"` — an explicit, per-environment opt-in —
 *      OR `NODE_ENV === "development"` (what `bun dev` sets); AND
 *   2. the process is not running in a DEPLOYED Vercel environment — neither
 *      `production` nor `preview` may ever serve this route, even if the flag
 *      is set there by mistake. Deployed environments are publicly reachable
 *      and a preview is typically wired to the same Supabase project as
 *      production, so an admin session there is an admin session on real data.
 *      To run E2E against a deploy, use the `E2E_USER_EMAIL` credential path in
 *      `e2e/auth.setup.ts` instead.
 *
 * Anything else returns 404. Being unset is off; no truthy-ish value other
 * than `"1"` counts; merely running in CI does not enable it.
 *
 * `E2E_DEV_LOGIN` exists because the nightly Playwright lane
 * (`.github/workflows/test.yml`, job `e2e`) runs `next build` + `next start`
 * against a throwaway local Supabase stack. `NODE_ENV` is "production" in that
 * server, so a NODE_ENV-only gate 404'd, `e2e/auth.setup.ts` timed out waiting
 * for `/dashboard`, and every authenticated spec failed (issue #644). The flag
 * is set on that job only — never repo-wide, never on a deployed environment.
 *
 * Usage: GET /api/auth/dev-login
 * Optional query param: ?redirect=/some-page
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { isValidRedirect } from "@/lib/auth-utils";

const TEST_EMAIL = "dev@brewery.test";
const TEST_PASSWORD = "devpassword123";

/**
 * Whether this route may mint a session. Evaluated per request rather than at
 * module scope so the gate reflects the server's actual runtime environment
 * (and so it stays testable without module-cache gymnastics).
 */
function isDevLoginEnabled(): boolean {
  // Hard floor: no deployed Vercel environment is ever eligible, flag or not.
  // (`VERCEL_ENV=development` only occurs under a local `vercel dev`, so it is
  // deliberately not on this list.)
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv === "production" || vercelEnv === "preview") return false;
  return process.env.E2E_DEV_LOGIN === "1" || process.env.NODE_ENV === "development";
}

export async function GET(request: NextRequest) {
  if (!isDevLoginEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const redirect = request.nextUrl.searchParams.get("redirect") || "/";
  const admin = await createAdminClient();

  // Ensure test user exists (idempotent)
  const { data: existingUsers } = await admin.auth.admin.listUsers();
  let testUser = existingUsers?.users?.find((u) => u.email === TEST_EMAIL);

  if (!testUser) {
    const { data: createData, error: createError } = await admin.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: "Dev User" },
    });
    if (createError) {
      return NextResponse.json(
        { error: "Failed to create test user", detail: createError.message },
        { status: 500 },
      );
    }
    testUser = createData.user;
  }

  // Ensure user_profiles has admin role (idempotent — runs every login)
  if (testUser) {
    const { error: upsertError } = await admin.from("user_profiles").upsert(
      {
        id: testUser.id,
        email: TEST_EMAIL,
        display_name: "Dev User",
        roles: ["admin"],
        status: "active",
      },
      { onConflict: "id" },
    );
    if (upsertError) {
      return NextResponse.json(
        { error: "Failed to upsert user profile", detail: upsertError.message },
        { status: 500 },
      );
    }
  }

  // Sign in via the regular server client (sets session cookies)
  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });

  if (signInError) {
    return NextResponse.json(
      { error: "Failed to sign in", detail: signInError.message },
      { status: 500 },
    );
  }

  const safeRedirect = isValidRedirect(redirect) ? redirect : "/";

  return NextResponse.redirect(new URL(safeRedirect, request.nextUrl.origin));
}
