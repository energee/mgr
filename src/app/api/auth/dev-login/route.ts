/**
 * Test Login Route — local development and opt-in E2E only.
 *
 * Creates a test user (if needed), gives it the `admin` role, and signs it in
 * with no credentials supplied by the caller. That is a full admin session, so
 * reachability is deliberately narrow. The route answers only when `VERCEL_ENV`
 * is either absent or a known-safe value (see the floor in `isDevLoginEnabled`)
 * AND one of these holds:
 *
 *   1. `NODE_ENV === "development"` — what `bun dev` sets. Unrestricted: this
 *      path is allowed against a hosted Supabase project, because pointing a
 *      local dev server at a shared project is a normal workflow here and the
 *      developer already holds those credentials.
 *
 *      This is an ACCEPTED, DELIBERATE exposure, and it is the widest hole in
 *      this route — wider than anything the loopback rule below addresses. Any
 *      host whose serving process is a dev server, wired to a hosted database
 *      and reachable by someone (LAN, tunnel, `0.0.0.0`, reverse proxy), hands
 *      that person uncredentialed admin. It is pre-existing behavior and
 *      narrowing it would change what developers can do, so it is tracked for a
 *      decision in issue #679 rather than quietly restricted here.
 *
 *   2. `E2E_DEV_LOGIN` is exactly `"1"` AND the Supabase project this server's
 *      own clients are built from has a loopback hostname (`localhost`,
 *      `127.0.0.1`, `[::1]`). A missing or unparseable URL fails closed.
 *
 * Anything else returns 404. Being unset is off; no truthy-ish value other
 * than `"1"` counts; merely running in CI does not enable it.
 *
 * ## Build-time inlining — why the gate reads `getSupabaseUrl()`
 *
 * `NEXT_PUBLIC_*` variables are inlined by the bundler at BUILD time. A
 * `process.env.NEXT_PUBLIC_SUPABASE_URL` read in this file therefore compiles
 * to whatever literal the build machine had; it is not a runtime read, however
 * much it looks like one in source. The first revision of this gate read it
 * that way while claiming to reflect "the server's actual runtime environment",
 * which was false and opened a real bypass: `src/lib/env.ts` returns the live
 * `process.env` when `SKIP_ENV_VALIDATION` is set (and `package.json`'s `build`
 * script sets it), so `createAdminClient()` could be pointed at a hosted
 * project at RUNTIME while the gate still saw a loopback literal baked in at
 * BUILD time — gate constant-true, connection remote.
 *
 * The fix is structural, not a patch: the gate resolves its URL through
 * `getSupabaseUrl()`, the exact accessor `createAdminClient()` and
 * `createClient()` use. Gate and client therefore read one value and cannot
 * disagree about which database is about to be touched, under any build/runtime
 * env skew. Whether that value is a baked literal or a live `process.env` read
 * still depends on `SKIP_ENV_VALIDATION` — but it is now the same answer for
 * both, which is the property that matters.
 *
 * Of the other inputs, `VERCEL_ENV` and `E2E_DEV_LOGIN` are ordinary runtime
 * reads (no `NEXT_PUBLIC_` prefix, so nothing inlines them). `NODE_ENV` is
 * neither: a production build constant-folds `process.env.NODE_ENV` to
 * `"production"`, so condition (1) is compiled out of the artifact entirely —
 * `NODE_ENV` does not appear in the emitted route chunk at all. THAT, not any
 * runtime check, is why setting `NODE_ENV=development` against a built artifact
 * cannot open this route. (An earlier version of this comment claimed
 * `next build` / `next start` "force `NODE_ENV=production`". They do not:
 * `node_modules/next/dist/bin/next` does
 * `process.env.NODE_ENV = process.env.NODE_ENV || defaultEnv` — a default, with
 * a warning on a non-standard value, not a force.)
 *
 * ## What the loopback condition on (2) buys, and what it does not
 *
 *   - BUYS: on the `E2E_DEV_LOGIN` path, the database this route would touch
 *     must be addressed by a loopback hostname, so the admin connection cannot
 *     leave the machine serving the request. That is what stops a stray
 *     `E2E_DEV_LOGIN=1` from minting admin against a hosted Supabase project on
 *     a host where the Vercel floor is inert — i.e. any non-Vercel host
 *     (self-hosted Docker, Fly, Railway), where `VERCEL_ENV` simply does not
 *     exist, and Vercel itself when "Automatically expose System Environment
 *     Variables" is off (issue #656). There, the flag alone used to be the
 *     whole gate.
 *   - DOES NOT mean "the database is disposable". Loopback constrains the
 *     network path, not the data behind it. A self-hosted Supabase/Kong on the
 *     same host, a sidecar container, an SSH tunnel, or a local reverse proxy
 *     all present a loopback hostname in front of a database that may hold real
 *     data. Run any of those with `E2E_DEV_LOGIN=1` and this route will mint
 *     admin on it.
 *   - DOES NOT constrain condition (1) in any way — see the note on it above
 *     and issue #679.
 *
 * `E2E_DEV_LOGIN` exists because the nightly Playwright lane
 * (`.github/workflows/test.yml`, job `e2e`) runs `next build` + `next start`
 * against a local Supabase stack it creates and throws away. `NODE_ENV` is
 * "production" in that server, so a NODE_ENV-only gate 404'd,
 * `e2e/auth.setup.ts` timed out waiting for `/dashboard`, and every
 * authenticated spec failed (issue #644). That job sets
 * `NEXT_PUBLIC_SUPABASE_URL` from `supabase status` on its own local stack, so
 * it satisfies the loopback condition. The flag is set on that job only —
 * never repo-wide, never on a deployed environment.
 *
 * To run E2E against a deploy, use the `E2E_USER_EMAIL` credential path in
 * `e2e/auth.setup.ts` instead.
 *
 * Usage: GET /api/auth/dev-login
 * Optional query param: ?redirect=/some-page
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getSupabaseUrl } from "@/lib/env";
import { isValidRedirect } from "@/lib/auth-utils";

const TEST_EMAIL = "dev@brewery.test";
const TEST_PASSWORD = "devpassword123";

/**
 * Hostnames that can only be reached on the machine serving the request.
 * Mirrors the local target list in `playwright.config.ts`. `new URL()` reports
 * an IPv6 host in brackets, and `[::1]` is the only form it can ever yield —
 * every bare spelling of `::1` throws — so no bare variant is listed.
 * `host.docker.internal` is deliberately absent: nothing in this repo's CI uses
 * it, and it resolves to the Docker host, which is a different machine.
 */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * `VERCEL_ENV` values that are not a deployment. Only a local `vercel dev`
 * reports `development`. Absent/empty means "not on Vercel at all" and is
 * handled separately.
 */
const NON_DEPLOYED_VERCEL_ENVS = new Set(["development"]);

/**
 * Whether the Supabase project this server's own clients are built from is
 * addressed by a loopback hostname.
 *
 * Resolved through `getSupabaseUrl()` on purpose — see the build-time inlining
 * note at the top of this file. The point is not convenience: it is that this
 * check and `createAdminClient()` read one value, so they cannot disagree about
 * the target database.
 *
 * Compares the parsed HOSTNAME, never a substring:
 * `https://localhost.evil.example.com` is a remote host that merely starts with
 * the word, and `https://localhost@evil.example.com` puts it in the userinfo.
 * Both must read as non-loopback. Missing or unparseable URLs fail closed — an
 * unreadable target is not evidence of a local database. (The annotation is
 * deliberate: `getSupabaseUrl()` is typed `string`, but under
 * `SKIP_ENV_VALIDATION` it is an unvalidated `process.env` read and can be
 * undefined at runtime.)
 */
function hasLoopbackSupabaseUrl(): boolean {
  const url: string | undefined = getSupabaseUrl();
  if (!url) return false;
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Whether this route may mint a session. Evaluated per request rather than at
 * module scope so that the genuine runtime reads (`VERCEL_ENV`,
 * `E2E_DEV_LOGIN`) are re-read on every call, and so the gate stays testable
 * without module-cache gymnastics. Note that not every input here is a runtime
 * read — see the build-time inlining note at the top of this file.
 */
function isDevLoginEnabled(): boolean {
  // Hard floor, fail closed: if VERCEL_ENV says anything at all, it must be a
  // value known NOT to be a deployment. Deny-by-default rather than denying
  // only `production`/`preview`, so an unrecognised or future value (a new
  // Vercel tier, "staging", a typo, a differently-cased "Production") cannot
  // fall through to the enabling conditions below.
  //
  // An absent or empty value means the app is not on Vercel — self-hosted
  // Docker, Fly, Railway, a VM — and this floor is simply inert there. That is
  // exactly why condition (2) also requires a loopback database (#656), and
  // why condition (1) remains exposed (#679).
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv && !NON_DEPLOYED_VERCEL_ENVS.has(vercelEnv)) return false;

  // A dev server: allowed against any project, including a hosted one.
  // Accepted, deliberate exposure — see the module docstring and issue #679.
  if (process.env.NODE_ENV === "development") return true;

  // The CI opt-in. Only ever meant for a local stack, so require one: this is
  // what stops the flag reaching a hosted project on a host where VERCEL_ENV
  // never gets set (#656).
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
