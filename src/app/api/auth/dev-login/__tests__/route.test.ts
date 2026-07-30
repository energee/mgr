/**
 * Dev-login route reachability tests (issues #644, #656).
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

import { createAdminClient, createClient } from "@/lib/supabase/server";
import { getSupabaseUrl } from "@/lib/env";
import { GET } from "@/app/api/auth/dev-login/route";

const mockedCreateAdminClient = vi.mocked(createAdminClient);
const mockedCreateClient = vi.mocked(createClient);
const mockedGetSupabaseUrl = vi.mocked(getSupabaseUrl);

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

  // Fail closed: an unparseable or absent URL is not evidence of a local stack.
  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["not a URL at all", "not-a-url"],
    ["scheme-relative", "//127.0.0.1:54321"],
    ["bare host", "127.0.0.1:54321"],
  ])("404s when E2E_DEV_LOGIN=1 and NEXT_PUBLIC_SUPABASE_URL is %s", async (_label, url) => {
    setupSupabase();
    vi.stubEnv("E2E_DEV_LOGIN", "1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);

    const response = await GET(request());

    expect(response.status).toBe(404);
    expect(mockedCreateAdminClient).not.toHaveBeenCalled();
  });

  // The loopback requirement is scoped to the flag. A developer running
  // `bun dev` against a hosted project is an existing, legitimate workflow and
  // must keep working exactly as before.
  it("still works under NODE_ENV=development against a hosted Supabase project", async () => {
    setupSupabase();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOSTED_SUPABASE_URL);

    const response = await GET(request());

    expect(response.status).toBe(307);
  });

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
});
