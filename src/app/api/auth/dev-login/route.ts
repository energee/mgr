/**
 * Test Login Route — local development and opt-in E2E only.
 *
 * Creates a test user (if needed), gives it the `admin` role, and signs it in
 * with no credentials supplied by the caller. That is a full admin session, so
 * reachability is deliberately narrow. The route answers only when it is NOT
 * running in a DEPLOYED Vercel environment (neither `production` nor `preview`,
 * flag or no flag) AND one of these holds:
 *
 *   1. `NODE_ENV === "development"` — what `bun dev` sets. A developer's own
 *      machine, unrestricted: this path is allowed against a hosted Supabase
 *      project, because pointing local dev at a shared project is a normal
 *      workflow and the developer already holds those credentials.
 *   2. `E2E_DEV_LOGIN` is exactly `"1"` AND `NEXT_PUBLIC_SUPABASE_URL` has a
 *      loopback hostname (`localhost`, `127.0.0.1`, `[::1]`). A missing or
 *      unparseable URL fails closed.
 *
 * Anything else returns 404. Being unset is off; no truthy-ish value other
 * than `"1"` counts; merely running in CI does not enable it.
 *
 * Why the extra loopback condition on (2) — issue #656. The Vercel floor is
 * correct but not sufficient by itself: `VERCEL_ENV` is absent entirely on a
 * non-Vercel host (self-hosted Docker, Fly, Railway), and can be absent on
 * Vercel too if "Automatically expose System Environment Variables" is off. On
 * such a host the flag alone was the whole gate. Requiring a loopback database
 * binds the flag to the only situation it was introduced for.
 *
 * What that does and does not prevent, precisely:
 *   - PREVENTS: an `E2E_DEV_LOGIN=1` misconfiguration minting an admin session
 *     against a remote Supabase project, on any host, including hosts where
 *     `VERCEL_ENV` is unset. The database holding real data is never reachable
 *     through this path.
 *   - DOES NOT prevent: a developer running `bun dev` against a hosted project
 *     from getting this route — that is condition (1), unchanged. Nor does it
 *     protect a genuinely local database; a local stack is throwaway by
 *     assumption, which is exactly why the flag is scoped to one.
 *
 * `E2E_DEV_LOGIN` exists because the nightly Playwright lane
 * (`.github/workflows/test.yml`, job `e2e`) runs `next build` + `next start`
 * against a throwaway local Supabase stack. `NODE_ENV` is "production" in that
 * server, so a NODE_ENV-only gate 404'd, `e2e/auth.setup.ts` timed out waiting
 * for `/dashboard`, and every authenticated spec failed (issue #644). That job
 * sets `NEXT_PUBLIC_SUPABASE_URL` from `supabase status` on its own local
 * stack, so it satisfies the loopback condition. The flag is set on that job
 * only — never repo-wide, never on a deployed environment.
 *
 * To run E2E against a deploy, use the `E2E_USER_EMAIL` credential path in
 * `e2e/auth.setup.ts` instead.
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
 * Hostnames that can only mean "a database on this machine". Mirrors the local
 * target list in `playwright.config.ts`. `new URL()` reports an IPv6 host in
 * brackets, so `[::1]` is the form actually seen; the bare `::1` is accepted
 * too for anyone hand-setting the variable. `host.docker.internal` is
 * deliberately absent — nothing in this repo's CI uses it, and it resolves to
 * the Docker host, which is a real machine.
 */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Whether the configured Supabase project is on this machine.
 *
 * Parses the URL and compares the HOSTNAME. It must not substring-match
 * "localhost": `https://localhost.evil.example.com` is a remote host that
 * merely starts with the word, and `https://localhost@evil.example.com` puts it
 * in the userinfo. Both must read as non-loopback. Missing or unparseable URLs
 * fail closed — an unreadable target is not evidence of a local stack.
 */
function hasLoopbackSupabaseUrl(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return false;
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Whether this route may mint a session. Evaluated per request rather than at
 * module scope so the gate reflects the server's actual runtime environment
 * (and so it stays testable without module-cache gymnastics).
 */
function isDevLoginEnabled(): boolean {
  // Hard floor: no deployed Vercel environment is ever eligible, flag or not.
  // (`VERCEL_ENV=development` only occurs under a local `vercel dev`, so it is
  // deliberately not on this list.) Still correct, but insufficient alone —
  // VERCEL_ENV is simply absent off Vercel, hence the loopback check below.
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv === "production" || vercelEnv === "preview") return false;

  // A developer's own machine: allowed against any project, incl. a hosted one.
  if (process.env.NODE_ENV === "development") return true;

  // The CI opt-in. Only ever meant for a throwaway local stack, so require one:
  // this is what stops the flag minting admin against real data on a host where
  // VERCEL_ENV never gets set (#656).
  return process.env.E2E_DEV_LOGIN === "1" && hasLoopbackSupabaseUrl();
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
