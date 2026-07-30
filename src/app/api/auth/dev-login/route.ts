/**
 * Test Login Route — local development and opt-in E2E only.
 *
 * Creates a test user (if needed), gives it the `admin` role, and signs it in
 * with no credentials supplied by the caller. That is a full admin session, so
 * reachability is deliberately narrow. The route answers only when `VERCEL_ENV`
 * is either absent or a known-safe value (see the floor in `isDevLoginEnabled`)
 * AND one of these holds:
 *
 *   1. `NODE_ENV === "development"` — what `bun dev` sets — AND the Supabase
 *      project this server's own clients are built from is either
 *
 *        a. addressed by a loopback hostname (`localhost`, `127.0.0.1`,
 *           `[::1]`), which is the silent default and covers `make db-local`;
 *           or
 *        b. a non-loopback ("remote") project WITH `DEV_LOGIN_ALLOW_REMOTE_DB`
 *           set to exactly `"1"`.
 *
 *      Pointing a local dev server at a shared hosted project is a normal
 *      workflow here and it still works — but it now has to be a choice
 *      somebody typed, not a silent default (issue #679). On a laptop wired to
 *      a local stack, nothing changed. When (b) is what is missing, the HTTP
 *      response stays an undifferentiated 404 and never carries the URL,
 *      hostname or any key — the explanation goes to the developer through two
 *      other channels: the login page renders the precondition next to the Dev
 *      Login button, and the refusal is logged server-side naming the variable
 *      (see `logDevServerRefusal` for what that log does and does not
 *      guarantee).
 *
 *   2. `E2E_DEV_LOGIN` is exactly `"1"` AND that same project has a loopback
 *      hostname. No opt-in widens this one: `DEV_LOGIN_ALLOW_REMOTE_DB` applies
 *      to condition (1) only, so a CI flag can never reach a hosted project.
 *
 * Anything else returns 404. Being unset is off; no truthy-ish value other
 * than `"1"` counts for either flag; merely running in CI does not enable it.
 * A Supabase URL the gate cannot resolve to a hostname — an `unknown` target —
 * denies both conditions regardless of any opt-in: an unreadable target is not
 * evidence about which database is behind it. That covers three shapes, not
 * one: absent/empty, unparseable (`new URL()` throws), and parseable-but-
 * hostless (`localhost:54321`, `file:///x`, `mailto:a@b` all parse and all
 * yield `hostname === ""`). `classifySupabaseTarget()` in `src/lib/dev-login.ts`
 * is where that is decided, and the suite pins each shape.
 *
 * The login page's Dev Login button is driven from the same module
 * (`devLoginAffordance()`), so the UI cannot offer an action this gate refuses
 * without saying why. A contract test in this route's suite drives both across
 * one matrix and fails if they diverge.
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
 * Of the other inputs, `VERCEL_ENV`, `E2E_DEV_LOGIN` and
 * `DEV_LOGIN_ALLOW_REMOTE_DB` are ordinary runtime reads (no `NEXT_PUBLIC_`
 * prefix, so nothing inlines them). `NODE_ENV` is
 * neither: a production build constant-folds `process.env.NODE_ENV` to
 * `"production"`, so condition (1) is compiled out of the artifact entirely —
 * `NODE_ENV` does not appear in the emitted route chunk at all. THAT, not any
 * runtime check, is why setting `NODE_ENV=development` against a built artifact
 * cannot open this route. (An earlier version of this comment claimed
 * `next build` / `next start` "force `NODE_ENV=production`". They do not:
 * `node_modules/next/dist/bin/next` does
 * `process.env.NODE_ENV = process.env.NODE_ENV || defaultEnv` — a default, with
 * a warning on a non-standard value, not a force.) A corollary worth stating:
 * because the whole of condition (1) is folded away, `DEV_LOGIN_ALLOW_REMOTE_DB`
 * is unreachable in a production build and cannot re-open the artifact either.
 *
 * ## What the loopback condition buys, and what it does not
 *
 *   - BUYS: the database this route would touch must be addressed by a loopback
 *     hostname, so the admin connection cannot leave the machine serving the
 *     request — unconditionally on the `E2E_DEV_LOGIN` path, and by default on
 *     the dev-server path. That is what stops a stray `E2E_DEV_LOGIN=1` from
 *     minting admin against a hosted Supabase project on a host where the
 *     Vercel floor is inert — i.e. any non-Vercel host (self-hosted Docker,
 *     Fly, Railway), where `VERCEL_ENV` simply does not exist, and Vercel
 *     itself when "Automatically expose System Environment Variables" is off
 *     (issue #656). There, the flag alone used to be the whole gate.
 *   - DOES NOT mean "the database is disposable". Loopback constrains the
 *     network path, not the data behind it. A self-hosted Supabase/Kong on the
 *     same host, a sidecar container, an SSH tunnel, or a local reverse proxy
 *     all present a loopback hostname in front of a database that may hold real
 *     data. Run any of those with `E2E_DEV_LOGIN=1` and this route will mint
 *     admin on it.
 *   - DOES NOT stop a developer from opting back out of it on the dev-server
 *     path. `DEV_LOGIN_ALLOW_REMOTE_DB=1` restores exactly the pre-#679
 *     behavior for condition (1): a dev server reachable over a LAN, a tunnel,
 *     a bound `0.0.0.0` or a reverse proxy, wired to a hosted project, hands
 *     uncredentialed admin to whoever can reach the port. What changed is that
 *     someone has to have typed the variable. Nothing here binds the LISTENING
 *     interface (tracked as issue #691) or asks the caller for a secret
 *     (issue #692); if you need those properties, do not set this variable.
 *     Note the loopback default constrains only the DATABASE hostname, so even
 *     without the opt-in a dev server bound to `0.0.0.0` against a local stack
 *     is open on the LAN — that is #691's territory, not this gate's.
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
import {
  ALLOW_REMOTE_DB_VALUE,
  ALLOW_REMOTE_DB_VAR,
  classifySupabaseTarget,
  type SupabaseTarget,
} from "@/lib/dev-login";
import { isValidRedirect } from "@/lib/auth-utils";
import { logger } from "@/lib/logger";

const TEST_EMAIL = "dev@brewery.test";
const TEST_PASSWORD = "devpassword123";

/**
 * `VERCEL_ENV` values that are not a deployment. Only a local `vercel dev`
 * reports `development`. Absent/empty means "not on Vercel at all" and is
 * handled separately.
 */
const NON_DEPLOYED_VERCEL_ENVS = new Set(["development"]);

/**
 * Explain a dev-server refusal to the one audience that can act on it.
 *
 * Deliberately server-side only: the HTTP response stays an undifferentiated
 * `404 Not found`, so nothing about which database this server is wired to
 * leaks to a caller. The hostname is left out of the log too — it adds nothing
 * the developer does not already have in their own env file, and keeps "no
 * target detail off the machine" true of the log as well as the response.
 *
 * WHAT THIS CHANNEL IS AND IS NOT. It is a `logger.warn`, so it reaches the
 * terminal only when pino's level allows `warn`. That is true of the dev
 * default (`debug`) but NOT when `LOG_LEVEL` is set to `error`, `fatal` or
 * `silent`, in which case the refusal is silent here. Output is also pino's
 * default JSON unless `pino-pretty` is installed (see `src/lib/logger.ts`), so
 * "readable in the `bun dev` terminal" means one JSON line, not prose. The
 * login page carries the same precondition on screen for exactly this reason —
 * see `devLoginAffordance()` in `src/lib/dev-login.ts` — so this log is a
 * second channel, not the only one.
 *
 * It fires on every denied request rather than once per process, which is a
 * deliberate call, not an oversight: the branch exists only under
 * `NODE_ENV === "development"` and is constant-folded out of a production
 * build entirely, so the only process that can emit it is a dev server, which
 * already prints a line per request. The message carries no per-request data,
 * so a caller cannot vary it; the volume is a constant factor on a log that is
 * already one-line-per-request. If that ever stops being true, dedupe by
 * `target` rather than dropping the message.
 */
function logDevServerRefusal(target: Exclude<SupabaseTarget, "loopback">): void {
  const why =
    target === "remote"
      ? `its Supabase project is not loopback. Set ${ALLOW_REMOTE_DB_VAR}=${ALLOW_REMOTE_DB_VALUE} to allow a credential-less admin login against it.`
      : `its Supabase URL is missing, or names no hostname (check the scheme — "localhost:54321" parses as a scheme, not a host), so the target database is unknown. Fix NEXT_PUBLIC_SUPABASE_URL — ${ALLOW_REMOTE_DB_VAR} does not override this.`;

  logger.warn(
    { route: "/api/auth/dev-login", supabaseTarget: target },
    `dev-login refused on a development server: ${why}`,
  );
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
  // exactly why both conditions below also care about which database is being
  // touched (#656, #679).
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv && !NON_DEPLOYED_VERCEL_ENVS.has(vercelEnv)) return false;

  const target = classifySupabaseTarget();

  // A dev server. Loopback is the silent default — `make db-local` and any
  // `supabase start` stack land here and behave exactly as they always have.
  // A hosted project still works, but only once somebody has typed the opt-in
  // (#679); `unknown` fails closed either way.
  if (process.env.NODE_ENV === "development") {
    if (target === "loopback") return true;
    // Literal `process.env.X`, not `process.env[ALLOW_REMOTE_DB_VAR]`: a static
    // read is what every bundler and reader expects of a security gate. The
    // constants exist for the refusal message; a test pins that the variable
    // they name is the one that actually opens this branch.
    if (target === "remote" && process.env.DEV_LOGIN_ALLOW_REMOTE_DB === ALLOW_REMOTE_DB_VALUE) {
      return true;
    }
    logDevServerRefusal(target);
    // Falls through rather than returning: the E2E condition below also demands
    // `loopback`, which `target` is not, so it cannot re-open what this closed.
  }

  // The CI opt-in. Only ever meant for a local stack, so require one: this is
  // what stops the flag reaching a hosted project on a host where VERCEL_ENV
  // never gets set (#656). No opt-in widens this — it is condition (1) only.
  return process.env.E2E_DEV_LOGIN === "1" && target === "loopback";
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
