/**
 * Dev-login route reachability tests (issue #644).
 *
 * This route hands out a full admin session with no caller credentials, so the
 * gate is the whole security surface. These tests pin both halves of it:
 *   - it OPENS for `E2E_DEV_LOGIN=1` even under NODE_ENV=production, which is
 *     what lets the nightly Playwright lane authenticate against `bun start`;
 *   - it STAYS SHUT by default, for every non-`"1"` flag value, and on any
 *     deployed Vercel environment regardless of the flag.
 *
 * `@/lib/supabase/server` is mocked wholesale — importing it for real runs
 * `@/lib/env`'s import-time Supabase validation (repo idiom, see
 * src/app/api/users/invite/__tests__/invite-route.test.ts).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeAdminMock } from "@/test/supabase-admin-mock";

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
}));

import { createAdminClient, createClient } from "@/lib/supabase/server";
import { GET } from "@/app/api/auth/dev-login/route";

const mockedCreateAdminClient = vi.mocked(createAdminClient);
const mockedCreateClient = vi.mocked(createClient);

const TEST_USER = { id: "dev-user-1", email: "dev@brewery.test" };

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

  // Hard floor: a misconfigured deployed environment must not be able to turn
  // this on, so VERCEL_ENV wins over both enabling conditions. Preview counts —
  // it is publicly reachable and typically shares production's Supabase project.
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

  it("rejects an off-site redirect target", async () => {
    setupSupabase();
    vi.stubEnv("E2E_DEV_LOGIN", "1");

    const response = await GET(
      new NextRequest("http://localhost:3000/api/auth/dev-login?redirect=https://evil.test/x"),
    );

    expect(response.headers.get("location")).toBe("http://localhost:3000/");
  });
});
