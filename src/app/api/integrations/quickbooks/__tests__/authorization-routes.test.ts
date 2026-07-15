/**
 * QuickBooks route authorization regression tests.
 *
 * These tests exercise the real API authorization guard with mocked Supabase
 * sessions so unauthorized callers cannot reach credential, cookie, token, or
 * service-role database side effects.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  const session = {
    user: { id: "user-1" } as { id: string } | null,
    authError: null as Error | null,
    roles: ["viewer"] as string[],
    profileError: null as Error | null,
  };

  const getUser = vi.fn(async () => ({
    data: { user: session.user },
    error: session.authError,
  }));
  const profileSingle = vi.fn(async () => ({
    data: session.profileError ? null : { roles: session.roles },
    error: session.profileError,
  }));
  const profileEq = vi.fn(() => ({ single: profileSingle }));
  const profileSelect = vi.fn(() => ({ eq: profileEq }));
  const from = vi.fn((table: string) => {
    if (table !== "user_profiles") {
      throw new Error(`Unexpected session query: ${table}`);
    }
    return { select: profileSelect };
  });
  const createClient = vi.fn(async () => ({
    auth: { getUser },
    from,
  }));

  const adminQuery = {
    select: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
    eq: vi.fn(),
    then: vi.fn(),
  };
  adminQuery.select.mockReturnValue(adminQuery);
  adminQuery.order.mockReturnValue(adminQuery);
  adminQuery.range.mockReturnValue(adminQuery);
  adminQuery.eq.mockReturnValue(adminQuery);
  adminQuery.then.mockImplementation((resolve) =>
    Promise.resolve({ data: [], error: null, count: 0 }).then(resolve),
  );
  const adminFrom = vi.fn(() => adminQuery);
  const createAdminClient = vi.fn(async () => ({ from: adminFrom }));

  const cookieValues = new Map<string, string>();
  const cookieGet = vi.fn((name: string) => {
    const value = cookieValues.get(name);
    return value === undefined ? undefined : { value };
  });
  const cookieSet = vi.fn((name: string, value: string) => {
    cookieValues.set(name, value);
  });
  const cookieDelete = vi.fn((name: string) => {
    cookieValues.delete(name);
  });
  const cookies = vi.fn(async () => ({
    get: cookieGet,
    set: cookieSet,
    delete: cookieDelete,
  }));

  const getClientCredentials = vi.fn(async () => ({
    clientId: "client-id",
    clientSecret: "client-secret",
  }));
  const exchangeCodeForTokens = vi.fn(async () => ({
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresIn: 3600,
  }));
  const saveTokens = vi.fn(async () => undefined);

  return {
    session,
    getUser,
    profileSingle,
    from,
    createClient,
    adminFrom,
    createAdminClient,
    cookieValues,
    cookieGet,
    cookieSet,
    cookieDelete,
    cookies,
    getClientCredentials,
    exchangeCodeForTokens,
    saveTokens,
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));

vi.mock("@/integrations/quickbooks", () => ({
  getClientCredentials: mocks.getClientCredentials,
  exchangeCodeForTokens: mocks.exchangeCodeForTokens,
  saveTokens: mocks.saveTokens,
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn() },
}));

import { GET as getAuthUrl } from "@/app/api/integrations/quickbooks/auth/route";
import { GET as handleCallback } from "@/app/api/integrations/quickbooks/callback/route";
import { GET as getSyncLog } from "@/app/api/integrations/quickbooks/sync-log/route";

const authRequest = () =>
  new NextRequest("http://localhost/api/integrations/quickbooks/auth");

const callbackRequest = (state = "valid-state") =>
  new NextRequest(
    `http://localhost/api/integrations/quickbooks/callback?code=auth-code&realmId=realm-1&state=${state}`,
  );

const syncLogRequest = () =>
  new NextRequest("http://localhost/api/integrations/quickbooks/sync-log");

function setAuthorizedUser(id = "user-1") {
  mocks.session.user = { id };
  mocks.session.roles = ["admin"];
}

function setOAuthCookies(userId = "user-1", state = "valid-state") {
  mocks.cookieValues.set("qbo_oauth_state", state);
  mocks.cookieValues.set("qbo_oauth_initiator", userId);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.user = { id: "user-1" };
  mocks.session.authError = null;
  mocks.session.roles = ["viewer"];
  mocks.session.profileError = null;
  mocks.cookieValues.clear();
});

describe("unauthenticated QuickBooks routes", () => {
  it("rejects before any protected side effect", async () => {
    mocks.session.user = null;
    setOAuthCookies();

    const authResponse = await getAuthUrl(authRequest());
    const callbackResponse = await handleCallback(callbackRequest());
    const syncLogResponse = await getSyncLog(syncLogRequest());

    expect(authResponse.status).toBe(401);
    expect(callbackResponse.status).toBe(307);
    expect(callbackResponse.headers.get("location")).toBe(
      "http://localhost/login",
    );
    expect(syncLogResponse.status).toBe(401);
    expect(mocks.getClientCredentials).not.toHaveBeenCalled();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
    expect(mocks.exchangeCodeForTokens).not.toHaveBeenCalled();
    expect(mocks.saveTokens).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.adminFrom).not.toHaveBeenCalled();
  });
});

describe("QuickBooks OAuth start authorization", () => {
  it("rejects a user without integrations:manage before credentials or state", async () => {
    const response = await getAuthUrl(authRequest());

    expect(response.status).toBe(403);
    expect(mocks.getClientCredentials).not.toHaveBeenCalled();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("binds authorized OAuth state to the initiating user", async () => {
    setAuthorizedUser();

    const response = await getAuthUrl(authRequest());
    const body = await response.json();
    const returnedState = new URL(body.data.url).searchParams.get("state");

    expect(response.status).toBe(200);
    expect(returnedState).toEqual(expect.any(String));
    expect(mocks.getClientCredentials).toHaveBeenCalledOnce();
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "qbo_oauth_state",
      returnedState,
      expect.objectContaining({ httpOnly: true, maxAge: 600 }),
    );
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "qbo_oauth_initiator",
      "user-1",
      expect.objectContaining({ httpOnly: true, maxAge: 600 }),
    );
  });
});

describe("QuickBooks OAuth callback authorization", () => {
  it("rechecks integrations:manage before exchanging or saving tokens", async () => {
    setOAuthCookies();

    const response = await handleCallback(callbackRequest());

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("qbo_error=");
    expect(mocks.exchangeCodeForTokens).not.toHaveBeenCalled();
    expect(mocks.saveTokens).not.toHaveBeenCalled();
  });

  it("rejects a callback session different from the authorized initiator", async () => {
    setAuthorizedUser("user-2");
    setOAuthCookies("user-1");

    const response = await handleCallback(callbackRequest());

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("qbo_error=");
    expect(mocks.exchangeCodeForTokens).not.toHaveBeenCalled();
    expect(mocks.saveTokens).not.toHaveBeenCalled();
  });

  it("preserves CSRF validation independently of authorization", async () => {
    setAuthorizedUser();
    setOAuthCookies("user-1", "different-state");

    const response = await handleCallback(callbackRequest());

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain(
      "qbo_error=Invalid+OAuth+state",
    );
    expect(mocks.exchangeCodeForTokens).not.toHaveBeenCalled();
    expect(mocks.saveTokens).not.toHaveBeenCalled();
  });

  it("exchanges and saves tokens for the authorized initiating user", async () => {
    setAuthorizedUser();
    setOAuthCookies();

    const response = await handleCallback(callbackRequest());

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("qbo_connected=true");
    expect(mocks.exchangeCodeForTokens).toHaveBeenCalledOnce();
    expect(mocks.saveTokens).toHaveBeenCalledOnce();
  });
});

describe("QuickBooks sync-log authorization", () => {
  it("rejects a user without integrations:manage before creating an admin query", async () => {
    const response = await getSyncLog(syncLogRequest());

    expect(response.status).toBe(403);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.adminFrom).not.toHaveBeenCalled();
  });

  it("allows an integration manager to query the sync log", async () => {
    setAuthorizedUser();

    const response = await getSyncLog(syncLogRequest());

    expect(response.status).toBe(200);
    expect(mocks.createAdminClient).toHaveBeenCalledOnce();
    expect(mocks.adminFrom).toHaveBeenCalledWith("qbo_sync_log");
  });
});
