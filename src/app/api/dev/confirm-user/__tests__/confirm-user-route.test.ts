/**
 * Dev confirm-user route tests (audit DL-6 sweep, backlog #17).
 *
 * Pins the case-INSENSITIVE auth-user lookup: Supabase stores auth emails
 * lowercased, so confirming "Buyer@Acme.com" must find "buyer@acme.com".
 * Pre-fix, the exact `===` find returned a spurious 404. Also covers the
 * non-string body guard and the NODE_ENV/ENABLE_DEV_ENDPOINTS gate.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

const { listUsers, updateUserById } = vi.hoisted(() => ({
  listUsers: vi.fn(),
  updateUserById: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { admin: { listUsers, updateUserById } } }),
}));

// @/lib/env validates Supabase vars at import time — mock what the route uses.
vi.mock("@/lib/env", () => ({
  clientEnv: { NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" },
  getServerEnv: () => ({ SUPABASE_SERVICE_ROLE_KEY: "service-role-key" }),
}));

import { POST } from "@/app/api/dev/confirm-user/route";

const req = (body: unknown) =>
  new NextRequest("http://localhost/api/dev/confirm-user", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("ENABLE_DEV_ENDPOINTS", "true");
  listUsers.mockResolvedValue({
    data: { users: [{ id: "u-1", email: "buyer@acme.com" }] },
    error: null,
  });
  updateUserById.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/dev/confirm-user", () => {
  it("finds the auth user case-insensitively (pre-fix 404)", async () => {
    const res = await POST(req({ email: "Buyer@Acme.com" }));

    expect(res.status).toBe(200);
    expect(updateUserById).toHaveBeenCalledWith("u-1", { email_confirm: true });
  });

  it("404s for a genuinely unknown email", async () => {
    const res = await POST(req({ email: "nobody@acme.com" }));

    expect(res.status).toBe(404);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("400s on a non-string email body", async () => {
    const res = await POST(req({ email: 42 }));

    expect(res.status).toBe(400);
    expect(listUsers).not.toHaveBeenCalled();
  });

  it("stays hidden (404) unless dev endpoints are explicitly enabled", async () => {
    vi.stubEnv("ENABLE_DEV_ENDPOINTS", "false");

    const res = await POST(req({ email: "buyer@acme.com" }));

    expect(res.status).toBe(404);
    expect(listUsers).not.toHaveBeenCalled();
  });
});
