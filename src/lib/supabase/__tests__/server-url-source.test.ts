/**
 * Pins the ONE property that closes the dev-login bypass (#656, PR #678):
 * `createAdminClient()` and `createClient()` resolve their Supabase project URL
 * through `getSupabaseUrl()`, the same accessor `/api/auth/dev-login`'s gate
 * reads.
 *
 * Why this deserves its own test rather than being taken as read: the gate and
 * the client used to reach for the URL by different routes — the gate did
 * `process.env.NEXT_PUBLIC_SUPABASE_URL` (inlined at BUILD time by the bundler)
 * while the client went through `clientEnv`, which returns raw `process.env`
 * whenever `SKIP_ENV_VALIDATION` is set at RUNTIME (`bun run build` sets it).
 * Those two can resolve to different databases: gate sees a loopback literal
 * baked in at build time and opens, client connects to a hosted project. Any
 * future edit that reverts either side to a direct `process.env` read
 * reintroduces that, and the route's own tests cannot see it because they run
 * unbundled, where all reads are live. This test fails instead.
 *
 * `@/lib/env` is mocked wholesale — importing it for real runs its import-time
 * Supabase validation (repo idiom).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const ACCESSOR_URL = "http://127.0.0.1:54321";
/** Deliberately different from ACCESSOR_URL: if a client reads process.env
 *  directly instead of the accessor, it picks this up and the test fails. */
const PROCESS_ENV_URL = "https://decoy.supabase.co";

vi.mock("@/lib/env", () => ({
  getSupabaseUrl: vi.fn(() => ACCESSOR_URL),
  clientEnv: { NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key" },
  getServerEnv: vi.fn(() => ({ SUPABASE_SERVICE_ROLE_KEY: "service-role-key" })),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ getAll: () => [], set: () => {} })),
}));

// Factories must not close over module-level variables — `vi.mock` is hoisted
// above them. The spies are picked up via `vi.mocked` after the imports below.
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ tag: "admin" })),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({ tag: "ssr" })),
}));

import { createClient as createSupabaseClientRaw } from "@supabase/supabase-js";
import { createServerClient as createServerClientRaw } from "@supabase/ssr";
import { getSupabaseUrl } from "@/lib/env";
import { createAdminClient, createClient } from "@/lib/supabase/server";

const createSupabaseClient = vi.mocked(createSupabaseClientRaw);
const createServerClient = vi.mocked(createServerClientRaw);
const mockedGetSupabaseUrl = vi.mocked(getSupabaseUrl);

describe("server Supabase clients resolve their URL through getSupabaseUrl()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetSupabaseUrl.mockReturnValue(ACCESSOR_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", PROCESS_ENV_URL);
  });

  it("createAdminClient() uses the accessor's URL, not process.env", async () => {
    await createAdminClient();

    expect(mockedGetSupabaseUrl).toHaveBeenCalled();
    expect(createSupabaseClient).toHaveBeenCalledWith(
      ACCESSOR_URL,
      "service-role-key",
      expect.anything(),
    );
  });

  it("createClient() uses the accessor's URL, not process.env", async () => {
    await createClient();

    expect(mockedGetSupabaseUrl).toHaveBeenCalled();
    expect(createServerClient).toHaveBeenCalledWith(
      ACCESSOR_URL,
      "anon-key",
      expect.anything(),
    );
  });

  // The gate in /api/auth/dev-login decides whether to run this route by
  // inspecting the same accessor. Changing what the accessor returns must move
  // the admin client with it — that is the "cannot disagree" property.
  it("follows the accessor when it changes", async () => {
    mockedGetSupabaseUrl.mockReturnValue("https://elsewhere.supabase.co");

    await createAdminClient();

    expect(createSupabaseClient).toHaveBeenCalledWith(
      "https://elsewhere.supabase.co",
      "service-role-key",
      expect.anything(),
    );
  });
});
