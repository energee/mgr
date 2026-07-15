/**
 * User-invite route tests (audit DL-6 sweep, backlog #17).
 *
 * Pins the case-INSENSITIVE duplicate pre-check: user_profiles.email mirrors
 * auth.users, which Supabase stores lowercased, so inviting "Buyer@Acme.com"
 * when "buyer@acme.com" already has a profile must CONFLICT before any invite
 * email is sent. Pre-fix, the exact `.eq("email")` missed the duplicate and
 * the request fell through to inviteUserByEmail's opaque "already registered"
 * branch.
 *
 * withPermission is stubbed to a pass-through per the repo idiom (see
 * src/app/api/square/sync/__tests__/sync-routes.test.ts); thrown ApiErrors
 * therefore surface as rejections rather than error responses.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  makeAdminMock,
  ilikePatternToRegex,
  type TableResponse,
  type Write,
} from "@/test/supabase-admin-mock";

vi.mock("@/lib/api/auth", () => ({
  withPermission:
    (_perm: string, handler: (req: unknown, ctx: unknown) => unknown) =>
    (req: unknown) =>
      handler(req, { user: { id: "admin-1" } }),
}));

vi.mock("@/lib/api/rate-limit", () => ({
  rateLimit: () => ({ success: true, resetMs: 0 }),
  getClientIp: () => "test-ip",
}));

// @/lib/env validates Supabase vars at import time — mock the one export used.
vi.mock("@/lib/env", () => ({ SITE_URL: "http://localhost:3000" }));

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/server";
import { POST } from "@/app/api/users/invite/route";

const mockedCreateAdminClient = vi.mocked(createAdminClient);

type ProfileRow = { id: string; email: string; status: string };

/** Every admin write, in order. Re-created per setup(). */
let writes: Write[];
let inviteUserByEmail: ReturnType<typeof vi.fn>;
let deleteUser: ReturnType<typeof vi.fn>;

/**
 * user_profiles response honoring the duplicate pre-check's filter with real
 * eq/ilike semantics (single row or null — the route uses maybeSingle).
 * Write chains (the post-invite roles update) resolve to a plain success.
 */
function setup(
  profiles: ProfileRow[],
  options: {
    profileWriteError?: { message: string };
    profileWriteData?: unknown;
    deleteUserError?: { message: string };
  } = {},
) {
  const profileTable: TableResponse = ({ calls, ops }) => {
    if (ops.length > 0) {
      return {
        data:
          options.profileWriteData === undefined
            ? { id: "new-user-1", roles: ["brewer"], status: "pending" }
            : options.profileWriteData,
        error: options.profileWriteError ?? null,
      };
    }
    const ilike = calls.find((c) => c.method === "ilike" && c.args[0] === "email");
    if (ilike) {
      const re = ilikePatternToRegex(String(ilike.args[1]));
      return { data: profiles.find((p) => re.test(p.email)) ?? null, error: null };
    }
    const eq = calls.find((c) => c.method === "eq" && c.args[0] === "email");
    if (eq) {
      return { data: profiles.find((p) => p.email === eq.args[1]) ?? null, error: null };
    }
    return { data: null, error: null };
  };

  const mock = makeAdminMock({ user_profiles: profileTable });
  writes = mock.writes;
  inviteUserByEmail = vi.fn(async (email: string) => ({
    data: { user: { id: "new-user-1", email } },
    error: null,
  }));
  deleteUser = vi.fn(async () => ({
    data: {},
    error: options.deleteUserError ?? null,
  }));
  const admin = {
    ...(mock.admin as object),
    auth: { admin: { inviteUserByEmail, deleteUser } },
  };
  mockedCreateAdminClient.mockResolvedValue(admin as never);
}

const req = (body: unknown) =>
  new NextRequest("http://localhost/api/users/invite", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/users/invite duplicate pre-check", () => {
  it("conflicts on a case-variant duplicate BEFORE sending any invite (pre-fix miss)", async () => {
    setup([{ id: "u-1", email: "buyer@acme.com", status: "active" }]);

    await expect(
      POST(req({ email: "Buyer@Acme.com", roles: ["sales"] })),
    ).rejects.toMatchObject({ name: "ApiError", code: "CONFLICT" });

    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it("still conflicts on an exact-case duplicate", async () => {
    setup([{ id: "u-1", email: "buyer@acme.com", status: "active" }]);

    await expect(
      POST(req({ email: "buyer@acme.com", roles: ["sales"] })),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect(inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("invites and applies roles when no profile matches", async () => {
    setup([{ id: "u-1", email: "someone-else@acme.com", status: "active" }]);

    const res = await POST(
      req({ email: "new@acme.com", roles: ["brewer"], display_name: "New Brewer" }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toMatchObject({
      id: "new-user-1",
      email: "new@acme.com",
      roles: ["brewer"],
    });
    expect(inviteUserByEmail).toHaveBeenCalledWith(
      "new@acme.com",
      expect.objectContaining({
        redirectTo: "http://localhost:3000/api/auth/callback",
      }),
    );
    expect(writes).toContainEqual(
      expect.objectContaining({
        table: "user_profiles",
        op: "update",
        row: expect.objectContaining({ roles: ["brewer"], status: "pending" }),
      }),
    );
  });

  it("removes the new Auth user when role assignment fails", async () => {
    setup([], { profileWriteError: { message: "role assignment failed" } });

    await expect(
      POST(req({ email: "new@acme.com", roles: ["brewer"] })),
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });

    expect(inviteUserByEmail).toHaveBeenCalledTimes(1);
    expect(deleteUser).toHaveBeenCalledWith("new-user-1");
  });

  it("removes the new Auth user when role assignment affects no profile row", async () => {
    setup([], { profileWriteData: null });

    await expect(
      POST(req({ email: "new@acme.com", roles: ["brewer"] })),
    ).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      message: expect.stringContaining("verification failed"),
    });

    expect(deleteUser).toHaveBeenCalledWith("new-user-1");
  });

  it("surfaces a compensation failure for operator repair", async () => {
    setup([], {
      profileWriteError: { message: "role assignment failed" },
      deleteUserError: { message: "auth cleanup failed" },
    });

    await expect(
      POST(req({ email: "new@acme.com", roles: ["brewer"] })),
    ).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      message: expect.stringContaining("auth cleanup failed"),
    });
    expect(deleteUser).toHaveBeenCalledWith("new-user-1");
  });
});
