/**
 * saveTokens optimistic-lock tests (#840).
 *
 * The refresh path must compare-and-swap the qbo_refresh_token row against the
 * token the refresh consumed, and discard the whole write when a concurrent
 * refresh (another serverless instance) already rotated it — last-write-wins
 * here strands the QBO connection with a dead pair.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeAdminMock, type Write } from "@/test/supabase-admin-mock";

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/server";
import { saveTokens } from "../token-manager";

const mockedCreateAdminClient = vi.mocked(createAdminClient);

const TOKENS = {
  accessToken: "at-new",
  refreshToken: "rt-new",
  realmId: "realm-1",
  expiresAt: "2026-01-01T00:00:00.000Z",
};

let casFilters: unknown[][] = [];

function setup(casMatches: boolean): Write[] {
  casFilters = [];
  const { admin, writes } = makeAdminMock({
    system_settings: ({ ops, calls }) => {
      if (!ops.includes("update")) return { data: [], error: null };
      casFilters.push(...calls.filter((c) => c.method === "eq").map((c) => c.args));
      return { data: casMatches ? [{ key: "qbo_refresh_token" }] : [], error: null };
    },
  });
  mockedCreateAdminClient.mockResolvedValue(admin as never);
  return writes;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saveTokens", () => {
  it("refresh path: CAS hit persists, without rewriting the refresh row in the upsert", async () => {
    const writes = setup(true);

    const result = await saveTokens(TOKENS, { expectedRefreshToken: "rt-old" });

    expect(result).toEqual({ saved: true });
    const update = writes.find((w) => w.op === "update");
    expect(update?.row).toEqual({ value: "rt-new" });
    // `value` is JSONB: the CAS filter must be the JSON-encoded literal, or
    // PostgREST rejects the cast with 22P02 (verified against local
    // PostgREST 2026-08-21) and every refresh-path persist fails.
    expect(casFilters).toContainEqual(["value", JSON.stringify("rt-old")]);
    const upsert = writes.find((w) => w.op === "upsert");
    const keys = (upsert?.row as Array<{ key: string }>).map((r) => r.key);
    expect(keys).toEqual(["qbo_access_token", "qbo_realm_id", "qbo_token_expires_at"]);
  });

  it("refresh path: CAS miss discards the write entirely", async () => {
    const writes = setup(false);

    const result = await saveTokens(TOKENS, { expectedRefreshToken: "rt-stale" });

    expect(result).toEqual({ saved: false });
    expect(writes.filter((w) => w.op === "upsert")).toHaveLength(0);
  });

  it("connect path: no expected token, all four rows upserted unconditionally", async () => {
    const writes = setup(true);

    const result = await saveTokens(TOKENS);

    expect(result).toEqual({ saved: true });
    expect(writes.filter((w) => w.op === "update")).toHaveLength(0);
    const upsert = writes.find((w) => w.op === "upsert");
    const keys = (upsert?.row as Array<{ key: string }>).map((r) => r.key);
    expect(keys).toContain("qbo_refresh_token");
    expect(keys).toHaveLength(4);
  });
});
