/**
 * saveTokens persistence tests (#840, #855).
 *
 * Persistence is one `save_qbo_tokens_atomic` RPC (00299): all four
 * system_settings rows commit in a single transaction, and on the refresh
 * path the RPC compare-and-swaps DB-side against the refresh token this
 * refresh consumed — a concurrent refresh (another serverless instance)
 * that already rotated the pair makes it return false, and last-write-wins
 * here would strand the QBO connection with a dead pair.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeAdminMock } from "@/test/supabase-admin-mock";

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/server";
import { saveTokens, clearTokens } from "../token-manager";

const mockedCreateAdminClient = vi.mocked(createAdminClient);

const TOKENS = {
  accessToken: "at-new",
  refreshToken: "rt-new",
  realmId: "realm-1",
  expiresAt: "2026-01-01T00:00:00.000Z",
};

function setup(rpcResult: { data: unknown; error: { message: string } | null }) {
  const { admin, writes, rpcCalls } = makeAdminMock({}, { rpc: rpcResult });
  mockedCreateAdminClient.mockResolvedValue(admin as never);
  return { writes, rpcCalls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saveTokens", () => {
  it("refresh path: passes the consumed refresh token as the CAS expectation", async () => {
    const { rpcCalls, writes } = setup({ data: true, error: null });

    const result = await saveTokens(TOKENS, { expectedRefreshToken: "rt-old" });

    expect(result).toEqual({ saved: true });
    expect(rpcCalls).toEqual([
      {
        fn: "save_qbo_tokens_atomic",
        args: {
          p_access_token: "at-new",
          p_refresh_token: "rt-new",
          p_realm_id: "realm-1",
          p_expires_at: "2026-01-01T00:00:00.000Z",
          p_expected_refresh_token: "rt-old",
        },
      },
    ]);
    // Everything goes through the RPC — no direct table writes remain.
    expect(writes).toHaveLength(0);
  });

  it("refresh path: CAS miss (RPC returns false) reports saved: false", async () => {
    setup({ data: false, error: null });

    const result = await saveTokens(TOKENS, { expectedRefreshToken: "rt-stale" });

    expect(result).toEqual({ saved: false });
  });

  it("connect path: no expected token, CAS expectation is null (unconditional write)", async () => {
    const { rpcCalls } = setup({ data: true, error: null });

    const result = await saveTokens(TOKENS);

    expect(result).toEqual({ saved: true });
    expect(rpcCalls[0]?.args).toMatchObject({ p_expected_refresh_token: null });
  });

  it("throws on RPC error", async () => {
    setup({ data: null, error: { message: "boom" } });

    await expect(saveTokens(TOKENS)).rejects.toThrow("Failed to save QBO tokens: boom");
  });
});

describe("clearTokens", () => {
  it("deletes via the lock-taking RPC, not a direct table delete", async () => {
    const { rpcCalls, writes } = setup({ data: null, error: null });

    await clearTokens();

    expect(rpcCalls).toEqual([{ fn: "clear_qbo_tokens_atomic", args: undefined }]);
    expect(writes).toHaveLength(0);
  });

  it("throws on RPC error", async () => {
    setup({ data: null, error: { message: "boom" } });

    await expect(clearTokens()).rejects.toThrow("Failed to clear QBO tokens: boom");
  });
});
