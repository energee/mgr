/**
 * Dev-login route reachability tests (issues #644, #656, #679).
 *
 * This route hands out a full admin session with no caller credentials, so the
 * gate is the whole security surface. These tests pin every half of it:
 *   - it OPENS for `E2E_DEV_LOGIN=1` even under NODE_ENV=production, which is
 *     what lets the nightly Playwright lane authenticate against `bun start`;
 *   - it STAYS SHUT by default, for every non-`"1"` flag value, and on any
 *     deployed Vercel environment regardless of the flag;
 *   - on the `E2E_DEV_LOGIN` path it additionally requires the Supabase URL to
 *     be loopback, so the flag cannot mint admin against a remote project on a
 *     host where `VERCEL_ENV` is absent (#656);
 *   - on the `NODE_ENV=development` path loopback is the silent default and a
 *     non-loopback project needs `DEV_LOGIN_ALLOW_REMOTE_DB=1` (#679);
 *   - it resolves that URL through `getSupabaseUrl()` — the accessor
 *     `createAdminClient()` uses — and not through `process.env` directly.
 *
 * ## What these tests CANNOT observe
 *
 * They import the module unbundled, where every `process.env` read is live. In
 * the shipped artifact `NEXT_PUBLIC_*` reads are inlined at build time, which
 * is precisely the defect that made the original `process.env`-reading gate a
 * frozen constant. No unit test in this suite can see that difference; the
 * evidence for it is a grep of the compiled server chunk (recorded in PR #678).
 * What these tests DO pin is the structural property that closes it: the gate
 * follows the shared accessor, so gate and admin client cannot resolve
 * different databases whatever the build/runtime env skew.
 *
 * `@/lib/supabase/server` is mocked wholesale — importing it for real runs
 * `@/lib/env`'s import-time Supabase validation (repo idiom, see
 * src/app/api/users/invite/__tests__/invite-route.test.ts). `@/lib/env` itself
 * is mocked for the same reason, with `getSupabaseUrl` delegating to
 * `process.env` by default so the URL cases below can keep driving the gate
 * with `vi.stubEnv`; the "reads the shared accessor" cases override it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeAdminMock } from "@/test/supabase-admin-mock";

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  getSupabaseUrl: vi.fn(() => process.env.NEXT_PUBLIC_SUPABASE_URL),
}));

// The refusal message is part of the contract for #679 — one of two places a
// developer learns which variable to set (the other is the login page; the HTTP
// response stays a bare 404 and says nothing) — so the logger is mocked to
// assert on it rather than to silence it.
//
// What this pins is the CALL, not the terminal. `logger.warn` reaches a
// developer only when pino's level allows `warn`: true of the dev default
// (`debug`), false under `LOG_LEVEL=error`/`fatal`/`silent`. No test here can
// observe that, which is exactly why the login page carries the same
// precondition on screen — see the affordance matrix at the bottom of this file
// and src/app/(auth)/login/__tests__/login-form.test.tsx.
const loggerWarn = vi.hoisted(() => vi.fn());
vi.mock("@/lib/logger", () => ({
  logger: { warn: loggerWarn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createAdminClient, createClient } from "@/lib/supabase/server";
import { getSupabaseUrl } from "@/lib/env";
import { devLoginAffordance, type DevLoginAffordance } from "@/lib/dev-login";
import { GET } from "@/app/api/auth/dev-login/route";

const mockedCreateAdminClient = vi.mocked(createAdminClient);
const mockedCreateClient = vi.mocked(createClient);
const mockedGetSupabaseUrl = vi.mocked(getSupabaseUrl);

/** Everything the logger was told, flattened, so a case can grep the advice. */
function warnedText(): string {
  return loggerWarn.mock.calls.map((call) => JSON.stringify(call)).join("\n");
}

const TEST_USER = { id: "dev-user-1", email: "dev@brewery.test" };

/** What `supabase start` hands the CI e2e job (see .github/workflows/test.yml). */
const LOOPBACK_SUPABASE_URL = "http://127.0.0.1:54321";
/** A hosted project — i.e. somebody else's real data. */
const HOSTED_SUPABASE_URL = "https://abcdefghijklmnop.supabase.co";

/** Wire an admin client that already has the test user, plus a signing-in client. */
function setupSupabase() {
  const { admin, writes } = makeAdminMock({ user_profiles: { data: null, error: null } });
  const signInWithPassword = vi.fn().mockResolvedValue({ error: null });

  mockedCreateAdminClient.mockResolvedValue({
    ...admin,
    auth: {
      admin: {
        listUsers: vi.fn().mockResolvedValue({ data: { users: [TEST_USER] }, error: null }),
        createUser: vi.fn(),
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial client stub
  } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial client stub
  mockedCreateClient.mockResolvedValue({ auth: { signInWithPassword } } as any);

  return { writes, signInWithPassword };
}

function request(): NextRequest {
  return new NextRequest("http://localhost:3000/api/auth/dev-login?redirect=/dashboard");
}

describe("GET /api/auth/dev-login gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Baseline: a production server with no opt-in anywhere. Individual tests
    // stub only the variable they are about.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("E2E_DEV_LOGIN", undefined);
    vi.stubEnv("VERCEL_ENV", undefined);
    // #679: the hosted-DB opt-in is off unless a case names it.
    vi.stubEnv("DEV_LOGIN_ALLOW_REMOTE_DB", undefined);
    // Loopback by default so the pre-existing cases isolate the variable they
    // name; the #656 cases below are the ones that vary the Supabase URL.
    // Stubbed explicitly rather than inherited, so these tests do not depend on
    // whatever `.env` the developer running them happens to have.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", LOOPBACK_SUPABASE_URL);
    // Re-assert the delegating default: individual tests may replace it.
    mockedGetSupabaseUrl.mockImplementation(() => process.env.NEXT_PUBLIC_SUPABASE_URL as string);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("404s on a production build with no opt-in flag", async () => {
    setupSupabase();

    const response = await GET(request());

    expect(response.status).toBe(404);
    expect(mockedCreateAdminClient).not.toHaveBeenCalled();
  });

  // The flag is compared to the exact string "1" — truthiness would let a
  // stray `E2E_DEV_LOGIN=false` open an admin login.
  it.each(["0", "", "true", "yes", "01", " 1"])(
    "404s when E2E_DEV_LOGIN is %o rather than exactly \"1\"",
    async (value) => {
      setupSupabase();
      vi.stubEnv("E2E_DEV_LOGIN", value);

      const response = await GET(request());

      expect(response.status).toBe(404);
      expect(mockedCreateAdminClient).not.toHaveBeenCalled();
    },
  );

  it("signs in and redirects when E2E_DEV_LOGIN=1, even under NODE_ENV=production", async () => {
    const { signInWithPassword } = setupSupabase();
    vi.stubEnv("E2E_DEV_LOGIN", "1");

    const response = await GET(request());

    // This is the #644 fix: the CI lane runs `bun start`, so NODE_ENV alone
    // could never let auth.setup.ts through.
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/dashboard");
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "dev@brewery.test",
      password: "devpassword123",
    });
  });

  it("still works in local development without the flag", async () => {
    setupSupabase();
    vi.stubEnv("NODE_ENV", "development");

    const response = await GET(request());

    expect(response.status).toBe(307);
  });

  // --- #656: the E2E_DEV_LOGIN path also requires a loopback database. -------
  // VERCEL_ENV is absent entirely off Vercel (self-hosted Docker, Fly, Railway),
  // so on those hosts it is the flag alone standing between a stray
  // `E2E_DEV_LOGIN=1` and a credential-less admin session. The flag exists only
  // for the nightly Playwright lane, which runs against a throwaway local
  // Supabase stack, so bind it to that fact.

  it.each([
    ["127.0.0.1", "http://127.0.0.1:54321"],
    ["localhost", "http://localhost:54321"],
    ["[::1]", "http://[::1]:54321"],
  ])("signs in with E2E_DEV_LOGIN=1 against a %s Supabase URL", async (_host, url) => {
    setupSupabase();
    vi.stubEnv("E2E_DEV_LOGIN", "1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);

    const response = await GET(request());

    expect(response.status).toBe(307);
  });

  // The case that matters: an operator sets the flag on a real host wired to a
  // hosted project. Nothing else would stop it there — VERCEL_ENV is unset.
  it("404s when E2E_DEV_LOGIN=1 but Supabase is a hosted project", async () => {
    setupSupabase();
    vi.stubEnv("E2E_DEV_LOGIN", "1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOSTED_SUPABASE_URL);

    const response = await GET(request());

    expect(response.status).toBe(404);
    expect(mockedCreateAdminClient).not.toHaveBeenCalled();
  });

  // The host is compared after URL parsing, not by substring: every value here
  // CONTAINS a loopback name while resolving somewhere else entirely.
  it.each([
    "https://localhost.evil.example.com",
    "https://127.0.0.1.evil.example.com",
    "https://evil.example.com/127.0.0.1",
    "https://evil.example.com/?h=localhost",
    "https://evil.example.com#localhost",
    // Userinfo, not host — `new URL(...).hostname` is "evil.example.com".
    "https://localhost@evil.example.com",
    // Deliberately NOT on the allow-list: nothing in this repo's CI needs it
    // (no reference in test.yml or playwright.config.ts), and it resolves to
    // the Docker *host*, which on a developer or server box is a real machine.
    "http://host.docker.internal:54321",
  ])("404s when E2E_DEV_LOGIN=1 and the Supabase URL is %o", async (url) => {
    setupSupabase();
    vi.stubEnv("E2E_DEV_LOGIN", "1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);

    const response = await GET(request());

    expect(response.status).toBe(404);
    expect(mockedCreateAdminClient).not.toHaveBeenCalled();
  });

  // Fail closed: a URL the gate cannot resolve to a hostname is not evidence of
  // a local stack. TWO distinct shapes below, and the split matters — the first
  // group makes `new URL()` throw, the second group PARSES and yields
  // `hostname === ""`. `localhost:54321` is the second kind (scheme `localhost:`,
  // path `54321`), and the classifier's first cut called that `remote`.
  it.each([
    // `new URL()` throws
    ["missing", undefined],
    ["empty", ""],
    ["not a URL at all", "not-a-url"],
    ["scheme-relative", "//127.0.0.1:54321"],
    ["bare host", "127.0.0.1:54321"],
    // parses, but names no host
    ["a scheme-less typo", "localhost:54321"],
    ["a file URL", "file:///x"],
    ["a mailto URL", "mailto:a@b"],
    ["a data URL", "data:text/plain,x"],
  ])("404s when E2E_DEV_LOGIN=1 and NEXT_PUBLIC_SUPABASE_URL is %s", async (_label, url) => {
    setupSupabase();
    vi.stubEnv("E2E_DEV_LOGIN", "1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);

    const response = await GET(request());

    expect(response.status).toBe(404);
    expect(mockedCreateAdminClient).not.toHaveBeenCalled();
  });

  // --- #679: the NODE_ENV=development path also cares which database it is ---
  // about to touch. Before this, condition (1) checked NOTHING about the target:
  // any host whose serving process is a dev server, wired to a hosted project
  // and reachable by someone (LAN, tunnel, bound 0.0.0.0, reverse proxy), handed
  // that person uncredentialed admin. Loopback is now the silent default and a
  // hosted project requires DEV_LOGIN_ALLOW_REMOTE_DB=1 — the workflow survives,
  // but only as something somebody typed.

  it.each([
    ["127.0.0.1", "http://127.0.0.1:54321"],
    ["localhost", "http://localhost:3000"],
    ["[::1]", "http://[::1]:54321"],
  ])(
    "signs in under NODE_ENV=development against a %s Supabase URL with no opt-in",
    async (_host, url) => {
      setupSupabase();
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);

      const response = await GET(request());

      // The unchanged case, and the common one: `make db-local` / `supabase
      // start`. Nothing to type, nothing logged.
      expect(response.status).toBe(307);
      expect(loggerWarn).not.toHaveBeenCalled();
    },
  );

  it("404s under NODE_ENV=development against a hosted project without the opt-in", async () => {
    setupSupabase();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOSTED_SUPABASE_URL);

    const response = await GET(request());

    expect(response.status).toBe(404);
    expect(mockedCreateAdminClient).not.toHaveBeenCalled();
  });

  // The denial has to be actionable or it just looks like a broken route. The
  // server log is one of the two channels that carry the reason (the login page
  // is the other), so pin that it names the variable AND its required value.
  // Asserted against the mocked logger: this shows the route ASKS for the
  // message, not that any particular terminal shows it.
  it("names DEV_LOGIN_ALLOW_REMOTE_DB in the server log when it refuses a hosted project", async () => {
    setupSupabase();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOSTED_SUPABASE_URL);

    await GET(request());

    expect(loggerWarn).toHaveBeenCalledTimes(1);
    expect(warnedText()).toContain("DEV_LOGIN_ALLOW_REMOTE_DB=1");
  });

  // ...and the response must stay an undifferentiated 404. A caller learns
  // neither that a dev server is behind it nor which project it points at.
  it("leaks no target detail into the refusal response body", async () => {
    setupSupabase();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOSTED_SUPABASE_URL);

    const response = await GET(request());
    const body = await response.text();

    expect(JSON.parse(body)).toEqual({ error: "Not found" });
    expect(body).not.toContain("abcdefghijklmnop");
    expect(body).not.toContain("supabase");
    expect(body).not.toContain("DEV_LOGIN_ALLOW_REMOTE_DB");
  });

  it("signs in against a hosted project once DEV_LOGIN_ALLOW_REMOTE_DB=1 is set", async () => {
    const { signInWithPassword } = setupSupabase();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOSTED_SUPABASE_URL);
    vi.stubEnv("DEV_LOGIN_ALLOW_REMOTE_DB", "1");

    const response = await GET(request());

    // The workflow the issue insists must keep working: a local dev server
    // pointed at a shared hosted project, now opted into explicitly.
    expect(response.status).toBe(307);
    expect(signInWithPassword).toHaveBeenCalled();
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  // Exact-value comparison, same as E2E_DEV_LOGIN: a half-set or misspelled
  // opt-in must fail closed rather than read as truthy.
  it.each(["0", "", "true", "yes", "TRUE", "01", " 1", "1 ", "2"])(
    "404s against a hosted project when DEV_LOGIN_ALLOW_REMOTE_DB is %o rather than exactly \"1\"",
    async (value) => {
      setupSupabase();
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOSTED_SUPABASE_URL);
      vi.stubEnv("DEV_LOGIN_ALLOW_REMOTE_DB", value);

      const response = await GET(request());

      expect(response.status).toBe(404);
      expect(mockedCreateAdminClient).not.toHaveBeenCalled();
    },
  );

  // An unresolvable target is `unknown`, and no opt-in overrides `unknown`:
  // "I accept a remote database" is not "I accept a database I cannot identify".
  //
  // The hostless-but-parseable rows are the ones that make that claim true. The
  // first cut of `classifySupabaseTarget()` only caught the throwing shapes, so
  // `localhost:54321` — the scheme-less typo a developer actually makes —
  // classified as `remote` and the opt-in DID admit it: 307, admin minted,
  // against a target with no resolvable host. Adversarial review of PR #682
  // found that; these rows are its red-check.
  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["not a URL at all", "not-a-url"],
    ["bare host", "127.0.0.1:54321"],
    ["a scheme-less typo", "localhost:54321"],
    ["a file URL", "file:///x"],
    ["a mailto URL", "mailto:a@b"],
    ["a data URL", "data:text/plain,x"],
  ])(
    "404s under NODE_ENV=development when the Supabase URL is %s, even with the opt-in",
    async (_label, url) => {
      setupSupabase();
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
      vi.stubEnv("DEV_LOGIN_ALLOW_REMOTE_DB", "1");

      const response = await GET(request());

      expect(response.status).toBe(404);
      expect(mockedCreateAdminClient).not.toHaveBeenCalled();
      // And it says so, rather than pointing at an opt-in that would not help.
      expect(warnedText()).toContain("does not override this");
    },
  );

  it("404s under NODE_ENV=development when the shared accessor returns undefined", async () => {
    setupSupabase();
    vi.stubEnv("NODE_ENV", "development");
    mockedGetSupabaseUrl.mockReturnValue(undefined as unknown as string);

    const response = await GET(request());

    expect(response.status).toBe(404);
    expect(mockedCreateAdminClient).not.toHaveBeenCalled();
  });

  // The load-bearing pair, mirroring #678's for the E2E path: `process.env` and
  // the accessor are set to CONTRADICT each other. The accessor is what
  // `createAdminClient()` connects with, so it must decide the gate both times —
  // otherwise a build-time-inlined NEXT_PUBLIC_ literal could say "loopback"
  // while the connection went to a hosted project.
  it("404s under NODE_ENV=development when the accessor says hosted and process.env says loopback", async () => {
    setupSupabase();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", LOOPBACK_SUPABASE_URL);
    mockedGetSupabaseUrl.mockReturnValue(HOSTED_SUPABASE_URL);

    const response = await GET(request());

    expect(response.status).toBe(404);
    expect(mockedCreateAdminClient).not.toHaveBeenCalled();
  });

  it("signs in under NODE_ENV=development when the accessor says loopback and process.env says hosted", async () => {
    setupSupabase();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOSTED_SUPABASE_URL);
    mockedGetSupabaseUrl.mockReturnValue(LOOPBACK_SUPABASE_URL);

    const response = await GET(request());

    // No opt-in set: allowed purely because the accessor — the gate's only
    // source of truth about the target — reports loopback.
    expect(response.status).toBe(307);
    expect(mockedGetSupabaseUrl).toHaveBeenCalled();
  });

  // Scope: the opt-in belongs to condition (1) alone. If it widened the CI flag
  // too, #656 would be reopened by a second variable.
  it("does not let DEV_LOGIN_ALLOW_REMOTE_DB widen the E2E_DEV_LOGIN path", async () => {
    setupSupabase();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("E2E_DEV_LOGIN", "1");
    vi.stubEnv("DEV_LOGIN_ALLOW_REMOTE_DB", "1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOSTED_SUPABASE_URL);

    const response = await GET(request());

    expect(response.status).toBe(404);
    expect(mockedCreateAdminClient).not.toHaveBeenCalled();
  });

  // And it is below the Vercel floor, not beside it.
  it.each(["production", "preview", "staging"])(
    "404s on VERCEL_ENV=%o even with NODE_ENV=development and the opt-in",
    async (vercelEnv) => {
      setupSupabase();
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("VERCEL_ENV", vercelEnv);
      vi.stubEnv("DEV_LOGIN_ALLOW_REMOTE_DB", "1");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOSTED_SUPABASE_URL);

      const response = await GET(request());

      expect(response.status).toBe(404);
      expect(mockedCreateAdminClient).not.toHaveBeenCalled();
      // The floor returns before the target is even classified, so there is no
      // "set this variable" advice to give — the answer is not a missing opt-in.
      expect(loggerWarn).not.toHaveBeenCalled();
    },
  );

  // --- #678: the gate must resolve its URL through the SAME accessor the ------
  // admin client uses. Reading `process.env.NEXT_PUBLIC_SUPABASE_URL` here
  // instead compiles to a build-time literal in the shipped artifact while
  // `createAdminClient()` can still be a live read (env.ts returns raw
  // `process.env` under SKIP_ENV_VALIDATION, which `bun run build` sets) — so
  // the gate could be constant-true about loopback while the connection went to
  // a hosted project. These two cases pin the accessor as the gate's only
  // source: `process.env` and the accessor are deliberately set to CONTRADICT
  // each other, and the accessor must win both times.

  it("404s when the shared accessor reports a hosted project, whatever process.env says", async () => {
    setupSupabase();
    vi.stubEnv("E2E_DEV_LOGIN", "1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", LOOPBACK_SUPABASE_URL);
    mockedGetSupabaseUrl.mockReturnValue(HOSTED_SUPABASE_URL);

    const response = await GET(request());

    expect(response.status).toBe(404);
    expect(mockedCreateAdminClient).not.toHaveBeenCalled();
  });

  it("signs in when the shared accessor reports loopback, whatever process.env says", async () => {
    setupSupabase();
    vi.stubEnv("E2E_DEV_LOGIN", "1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOSTED_SUPABASE_URL);
    mockedGetSupabaseUrl.mockReturnValue(LOOPBACK_SUPABASE_URL);

    const response = await GET(request());

    expect(response.status).toBe(307);
    expect(mockedGetSupabaseUrl).toHaveBeenCalled();
  });

  // Fail closed if the accessor itself yields nothing — under
  // SKIP_ENV_VALIDATION it is an unvalidated `process.env` read, so `undefined`
  // is reachable even though the type says `string`.
  it("404s when the shared accessor returns undefined", async () => {
    setupSupabase();
    vi.stubEnv("E2E_DEV_LOGIN", "1");
    mockedGetSupabaseUrl.mockReturnValue(undefined as unknown as string);

    const response = await GET(request());

    expect(response.status).toBe(404);
    expect(mockedCreateAdminClient).not.toHaveBeenCalled();
  });

  // Hard floor: a misconfigured deployed environment must not be able to turn
  // this on, so VERCEL_ENV wins over both enabling conditions. Preview counts —
  // it is publicly reachable and typically shares production's Supabase project.
  // Note the baseline Supabase URL is loopback here, so these also pin that a
  // loopback database does not buy its way past the Vercel floor.
  it.each([
    ["production", "E2E_DEV_LOGIN", "1"],
    ["production", "NODE_ENV", "development"],
    ["preview", "E2E_DEV_LOGIN", "1"],
    ["preview", "NODE_ENV", "development"],
  ])("404s on a Vercel %s deployment even with %s=%s", async (vercelEnv, name, value) => {
    setupSupabase();
    vi.stubEnv(name, value);
    vi.stubEnv("VERCEL_ENV", vercelEnv);

    const response = await GET(request());

    expect(response.status).toBe(404);
    expect(mockedCreateAdminClient).not.toHaveBeenCalled();
  });

  // --- #678: the floor is deny-by-default, not deny-a-list. ------------------
  // Previously it denied only the exact strings "production" and "preview", so
  // ANY other VERCEL_ENV value fell through to the enabling conditions. An
  // unrecognised deployment environment must fail closed instead.
  it.each([
    "staging",
    "Production", // casing — Vercel's own values are lowercase, but don't rely on it
    "PREVIEW",
    "prod",
    "dev",
    "0",
  ])("404s on an unrecognised VERCEL_ENV=%o even with E2E_DEV_LOGIN=1", async (vercelEnv) => {
    setupSupabase();
    vi.stubEnv("E2E_DEV_LOGIN", "1");
    vi.stubEnv("VERCEL_ENV", vercelEnv);

    const response = await GET(request());

    expect(response.status).toBe(404);
    expect(mockedCreateAdminClient).not.toHaveBeenCalled();
  });

  // The one Vercel value that is not a deployment: `vercel dev`, which runs on
  // the developer's own machine. It must not be swept up by the inversion.
  it("still works under VERCEL_ENV=development (local `vercel dev`)", async () => {
    setupSupabase();
    vi.stubEnv("E2E_DEV_LOGIN", "1");
    vi.stubEnv("VERCEL_ENV", "development");

    const response = await GET(request());

    expect(response.status).toBe(307);
  });

  // Empty means "the variable exists but says nothing" — the same situation as
  // absent (not on Vercel, or system env vars not exposed), so it must fall
  // through to the enabling conditions rather than deny.
  it("treats an empty VERCEL_ENV as 'not on Vercel'", async () => {
    setupSupabase();
    vi.stubEnv("E2E_DEV_LOGIN", "1");
    vi.stubEnv("VERCEL_ENV", "");

    const response = await GET(request());

    expect(response.status).toBe(307);
  });

  it("rejects an off-site redirect target", async () => {
    setupSupabase();
    vi.stubEnv("E2E_DEV_LOGIN", "1");

    const response = await GET(
      new NextRequest("http://localhost:3000/api/auth/dev-login?redirect=https://evil.test/x"),
    );

    expect(response.headers.get("location")).toBe("http://localhost:3000/");
  });

  // WHATWG URL parsing treats `\` as `/` for http(s), so a backslash-prefixed
  // "path" is a protocol-relative reference in disguise:
  // new URL("/\\evil.example.com", origin) → http://evil.example.com/ (#737).
  it.each([
    ["/\\evil.example.com"],
    ["\\\\evil.example.com"],
  ])("rejects a backslash redirect target (%s)", async (target) => {
    setupSupabase();
    vi.stubEnv("E2E_DEV_LOGIN", "1");

    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/auth/dev-login?redirect=${encodeURIComponent(target)}`,
      ),
    );

    expect(response.headers.get("location")).toBe("http://localhost:3000/");
  });

  // --- The login page's button must not drift away from this gate. ----------
  // PR #682's first cut tightened the gate and left
  // src/app/(auth)/login/login-form.tsx offering the Dev Login button on
  // `process.env.NODE_ENV === "development"` alone. Result: the button renders,
  // the route refuses, and the browser lands on a raw `{"error":"Not found"}`
  // page whose reason exists only in the server terminal. Both now read
  // `src/lib/dev-login.ts`; these cases drive the UI helper and the gate across
  // ONE matrix so a future edit to either has to keep them consistent.

  /** What the gate does for the current env, as a status code. */
  async function gateStatus(): Promise<number> {
    setupSupabase();
    return (await GET(request())).status;
  }

  it.each<[string, string | undefined, string | undefined, DevLoginAffordance, number]>([
    // label,                    supabase URL,           opt-in,    affordance,      status
    ["loopback, no opt-in", LOOPBACK_SUPABASE_URL, undefined, "ready", 307],
    ["loopback, opt-in set", LOOPBACK_SUPABASE_URL, "1", "ready", 307],
    ["hosted, no opt-in", HOSTED_SUPABASE_URL, undefined, "needs-opt-in", 404],
    ["hosted, opt-in set", HOSTED_SUPABASE_URL, "1", "needs-opt-in", 307],
    ["hostless, no opt-in", "localhost:54321", undefined, "hidden", 404],
    ["hostless, opt-in set", "localhost:54321", "1", "hidden", 404],
    ["unparseable, opt-in set", "not-a-url", "1", "hidden", 404],
  ])(
    "dev server, %s: the button is %s and the gate answers %s",
    async (_label, url, optIn, affordance, status) => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
      vi.stubEnv("DEV_LOGIN_ALLOW_REMOTE_DB", optIn);

      expect(devLoginAffordance()).toBe(affordance);
      expect(await gateStatus()).toBe(status);
    },
  );

  // The two directions that matter, stated as invariants rather than rows:
  //   - `hidden` must mean "no server env can make this answer" — otherwise the
  //     page hides a button that would have worked;
  //   - anything NOT hidden must be explicable on screen — `ready` works with
  //     no configuration, `needs-opt-in` works once the (server-only, so
  //     browser-invisible) opt-in is set, which is what the page says.
  it("never shows the button for a target no opt-in can open", async () => {
    for (const url of ["localhost:54321", "file:///x", "mailto:a@b", "not-a-url", ""]) {
      for (const optIn of [undefined, "1"]) {
        vi.stubEnv("NODE_ENV", "development");
        vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
        vi.stubEnv("DEV_LOGIN_ALLOW_REMOTE_DB", optIn);

        expect(devLoginAffordance(), `${url} with opt-in ${optIn}`).toBe("hidden");
        expect(await gateStatus(), `${url} with opt-in ${optIn}`).toBe(404);
      }
    }
  });

  it("hides the button outside a dev server, whatever the database is", () => {
    for (const nodeEnv of ["production", "test"]) {
      for (const url of [LOOPBACK_SUPABASE_URL, HOSTED_SUPABASE_URL]) {
        vi.stubEnv("NODE_ENV", nodeEnv);
        vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
        vi.stubEnv("DEV_LOGIN_ALLOW_REMOTE_DB", "1");

        expect(devLoginAffordance(), `${nodeEnv} / ${url}`).toBe("hidden");
      }
    }
  });

  // Structural, because the behavioral cases above cannot see a SECOND copy of
  // the predicate appearing next to the shared one. This is the check that
  // would have failed on PR #682's first cut.
  it("keeps the login form off its own NODE_ENV predicate", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/(auth)/login/login-form.tsx"),
      "utf8",
    );

    expect(source).toContain('from "@/lib/dev-login"');
    // Strip the module docstring: it *describes* the predicate that was removed.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code, "login-form.tsx must not re-derive dev-login reachability").not.toContain(
      "NODE_ENV",
    );
    expect(code, "login-form.tsx must not re-derive the loopback host list").not.toContain(
      "127.0.0.1",
    );
  });
});
