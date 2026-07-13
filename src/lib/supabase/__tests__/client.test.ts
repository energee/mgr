import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/env", () => ({
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
  },
}));

const { createBrowserClient } = vi.hoisted(() => ({
  createBrowserClient: vi.fn(() => ({ id: Math.random() })),
}));

vi.mock("@supabase/ssr", () => ({ createBrowserClient }));

describe("createClient (browser)", () => {
  beforeEach(() => {
    vi.resetModules();
    createBrowserClient.mockClear();
  });

  it("returns the same client instance across repeated calls", async () => {
    const { createClient } = await import("../client");

    const first = createClient();
    const second = createClient();
    const third = createClient();

    // Every previous createClient() call built a brand new GoTrueClient bound
    // to the same auth storage key. Concurrent instances (e.g. one per
    // mounted component) raced over the same navigator.locks name, and a
    // later instance's lock acquisition could "steal" the lock from an
    // earlier instance's in-flight supabase.auth.getSession()/getUser() call,
    // aborting it with "AbortError: Lock broken by another request with the
    // 'steal' option" (SENTRY-7597067722). Reusing one instance closes the race.
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(createBrowserClient).toHaveBeenCalledTimes(1);
  });
});
