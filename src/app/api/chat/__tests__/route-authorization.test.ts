/**
 * Chat route authorization and durable rate-limit regressions (issue #448).
 *
 * The real auth wrappers are exercised with mocked Supabase sessions. This
 * proves forbidden callers cannot reach service-role settings, the durable
 * limiter, Anthropic, or caller-scoped tools.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  const session = {
    user: { id: "user-1" } as { id: string } | null,
    authError: null as Error | null,
    roles: ["viewer"] as string[],
    status: "active",
  };

  const getUser = vi.fn(async () => ({
    data: { user: session.user },
    error: session.authError,
  }));

  const profileSingle = vi.fn(async (columns: string) => ({
    data: columns === "status"
      ? { status: session.status }
      : { roles: session.roles, status: session.status },
    error: null,
  }));
  const preferencesSingle = vi.fn(async () => ({
    data: { anthropic_api_key: null },
    error: null,
  }));

  const callerFrom = vi.fn((table: string) => {
    if (table === "user_profiles") {
      let selected = "";
      const query = {
        select: vi.fn((columns: string) => {
          selected = columns;
          return query;
        }),
        eq: vi.fn(() => query),
        single: vi.fn(() => profileSingle(selected)),
      };
      return query;
    }
    if (table === "user_preferences") {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        single: preferencesSingle,
      };
      return query;
    }
    throw new Error(`Unexpected caller query: ${table}`);
  });
  const callerClient = { auth: { getUser }, from: callerFrom };
  const createClient = vi.fn(async () => callerClient);

  const limiter = {
    data: [{ allowed: true, remaining: 9, reset_at: "2030-01-01T00:00:30.000Z" }] as
      | Array<{ allowed: boolean; remaining: number; reset_at: string }>
      | null,
    error: null as { message: string } | null,
  };
  const rpc = vi.fn(async () => limiter);
  const settingSingle = vi.fn(async () => ({
    data: { value: "global-anthropic-key" },
    error: null,
  }));
  const adminFrom = vi.fn((table: string) => {
    if (table !== "system_settings") {
      throw new Error(`Unexpected admin query: ${table}`);
    }
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      single: settingSingle,
    };
    return query;
  });
  const adminClient = { from: adminFrom, rpc };
  const createAdminClient = vi.fn(async () => adminClient);

  const model = vi.fn(() => "anthropic-model");
  const createAnthropic = vi.fn(() => model);
  const toUIMessageStreamResponse = vi.fn(() => new Response("ok", { status: 200 }));
  const streamText = vi.fn(() => ({ toUIMessageStreamResponse }));
  const convertToModelMessages = vi.fn(async () => []);
  const stepCountIs = vi.fn(() => "stop-condition");
  const createChatTools = vi.fn(() => ({ tool: "caller-scoped" }));

  return {
    session,
    getUser,
    callerFrom,
    callerClient,
    createClient,
    limiter,
    rpc,
    settingSingle,
    adminFrom,
    adminClient,
    createAdminClient,
    model,
    createAnthropic,
    toUIMessageStreamResponse,
    streamText,
    convertToModelMessages,
    stepCountIs,
    createChatTools,
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("ai", () => ({
  streamText: mocks.streamText,
  convertToModelMessages: mocks.convertToModelMessages,
  stepCountIs: mocks.stepCountIs,
}));

vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: mocks.createAnthropic }));
vi.mock("../tools", () => ({ createChatTools: mocks.createChatTools }));
vi.mock("@/services/entity-service", () => ({ entityService: { getById: vi.fn() } }));
vi.mock("@/entities/cores", () => ({ coreRegistry: new Map() }));
vi.mock("@/lib/logger", () => ({
  logger: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  },
}));

import { POST } from "../route";

const request = () =>
  new NextRequest("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [] }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.user = { id: "user-1" };
  mocks.session.authError = null;
  mocks.session.roles = ["viewer"];
  mocks.session.status = "active";
  mocks.limiter.data = [
    { allowed: true, remaining: 9, reset_at: "2030-01-01T00:00:30.000Z" },
  ];
  mocks.limiter.error = null;
});

function expectNoProtectedEffects() {
  expect(mocks.createAdminClient).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.adminFrom).not.toHaveBeenCalled();
  expect(mocks.createAnthropic).not.toHaveBeenCalled();
  expect(mocks.createChatTools).not.toHaveBeenCalled();
}

describe("chat authorization", () => {
  it("rejects an unauthenticated caller before protected effects", async () => {
    mocks.session.user = null;

    const response = await POST(request());

    expect(response.status).toBe(401);
    expectNoProtectedEffects();
  });

  it("rejects a portal customer before service-role or provider access", async () => {
    mocks.session.roles = ["customer"];

    const response = await POST(request());

    expect(response.status).toBe(403);
    expectNoProtectedEffects();
  });

  it("rejects an active account without an authorized staff role", async () => {
    mocks.session.roles = [];

    const response = await POST(request());

    expect(response.status).toBe(403);
    expectNoProtectedEffects();
  });

  it("allows staff and keeps tools on the caller-scoped client", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.createAdminClient).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("consume_ai_rate_limit", {
      p_user_id: "user-1",
      p_window_seconds: 60,
      p_max_requests: 10,
    });
    expect(mocks.adminFrom).toHaveBeenCalledWith("system_settings");
    expect(mocks.createAnthropic).toHaveBeenCalledWith({ apiKey: "global-anthropic-key" });
    expect(mocks.createChatTools).toHaveBeenCalledWith(mocks.callerClient);
  });
});

describe("chat durable rate limit", () => {
  it("returns 429 before key or provider access when the user bucket is exhausted", async () => {
    mocks.limiter.data = [
      { allowed: false, remaining: 0, reset_at: "2030-01-01T00:00:30.000Z" },
    ];

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(mocks.settingSingle).not.toHaveBeenCalled();
    expect(mocks.createAnthropic).not.toHaveBeenCalled();
    expect(mocks.createChatTools).not.toHaveBeenCalled();
  });

  it("fails closed before key or provider access when the limiter errors", async () => {
    mocks.limiter.data = null;
    mocks.limiter.error = { message: "database unavailable" };

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(mocks.settingSingle).not.toHaveBeenCalled();
    expect(mocks.createAnthropic).not.toHaveBeenCalled();
    expect(mocks.createChatTools).not.toHaveBeenCalled();
  });
});
