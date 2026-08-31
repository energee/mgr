/**
 * qboRequest retry sequencing.
 *
 * The 401-refresh-once guard and the 429-rate-limit retry loop share one
 * `retryCount` parameter. A 429 retry bumps `retryCount` to 1 before the
 * request is even re-sent, so a 401 that then arrives on that retry finds
 * `retryCount !== 0` and skips the refresh entirely, throwing instead of
 * self-healing — even though no auth refresh has actually been attempted
 * yet for this logical request.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../token-manager", () => ({
  getTokens: vi.fn(),
  getClientCredentials: vi.fn(),
  saveTokens: vi.fn(),
}));

import { getTokens, getClientCredentials, saveTokens } from "../token-manager";
import { qboClient } from "../client";

const mockedGetTokens = vi.mocked(getTokens);
const mockedGetClientCredentials = vi.mocked(getClientCredentials);
const mockedSaveTokens = vi.mocked(saveTokens);

const BASE_TOKENS = {
  accessToken: "at-old",
  refreshToken: "rt-old",
  realmId: "realm-1",
  expiresAt: "2030-01-01T00:00:00.000Z",
  environment: "sandbox" as const,
};

function fakeResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (key: string) => headers[key] ?? null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

describe("qboRequest retry sequencing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetTokens.mockResolvedValue(BASE_TOKENS);
    mockedGetClientCredentials.mockResolvedValue({
      clientId: "cid",
      clientSecret: "csecret",
    });
    mockedSaveTokens.mockResolvedValue({ saved: true });
  });

  it("still refreshes on a 401 that arrives after an earlier 429 retry", async () => {
    const fetchMock = vi
      .fn()
      // 1st QBO call: rate limited
      .mockResolvedValueOnce(fakeResponse(429, {}, { "Retry-After": "0" }))
      // 2nd QBO call (the 429 retry): token expired mid-flight
      .mockResolvedValueOnce(fakeResponse(401, {}))
      // OAuth token refresh call
      .mockResolvedValueOnce(
        fakeResponse(200, {
          access_token: "at-new",
          refresh_token: "rt-new",
          expires_in: 3600,
        })
      )
      // 3rd QBO call (after refresh): success
      .mockResolvedValueOnce(fakeResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await qboClient.get<{ ok: boolean }>("/customer/1");

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    vi.unstubAllGlobals();
  });
});
