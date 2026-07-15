/**
 * API authorization account-status regressions (issue #441).
 *
 * A valid Supabase session is not sufficient: every shared API wrapper must
 * fail closed unless the matching user_profiles row exists and is active.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";

const mockedCreateClient = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockedCreateClient,
}));

import {
  requirePermission,
  withAuth,
  withPermission,
  type AuthContext,
} from "../auth";

const USER = { id: "user-1", email: "admin@example.com" } as User;

type ProfileResponse = {
  data: { roles?: string[]; status?: string } | null;
  error: { message: string } | null;
};

function makeClient(profile: ProfileResponse, user: User | null = USER) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn(async () => profile),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);

  const client = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user },
        error: user ? null : { message: "no session" },
      })),
    },
    from: vi.fn(() => builder),
  };
  return { client, builder };
}

function context(client: ReturnType<typeof makeClient>["client"]): AuthContext {
  return { user: USER, supabase: client as never };
}

beforeEach(() => {
  mockedCreateClient.mockReset();
});

describe("requirePermission account status", () => {
  it("allows an active profile with the requested permission", async () => {
    const { client, builder } = makeClient({
      data: { roles: ["admin"], status: "active" },
      error: null,
    });

    const result = await requirePermission("users:manage", context(client));

    expect(result.roles).toEqual(["admin"]);
    expect(builder.select).toHaveBeenCalledWith("roles, status");
  });

  it.each(["inactive", "pending"])(
    "rejects a %s profile even when its roles grant the permission",
    async (status) => {
      const { client } = makeClient({
        data: { roles: ["admin"], status },
        error: null,
      });

      await expect(
        requirePermission("users:manage", context(client)),
      ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    },
  );

  it("rejects a missing profile", async () => {
    const { client } = makeClient({ data: null, error: null });

    await expect(
      requirePermission("users:manage", context(client)),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("rejects a profile read error", async () => {
    const { client } = makeClient({
      data: null,
      error: { message: "database unavailable" },
    });

    await expect(
      requirePermission("users:manage", context(client)),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });
});

describe("shared API wrappers account status", () => {
  it.each(["inactive", "pending"])(
    "withAuth blocks a %s session before the route handler runs",
    async (status) => {
      const { client } = makeClient({ data: { status }, error: null });
      mockedCreateClient.mockResolvedValue(client);
      const downstream = vi.fn(async () => NextResponse.json({ ok: true }));
      const route = withAuth(downstream);

      const response = await route(new NextRequest("http://localhost/api/test"));

      expect(response.status).toBe(403);
      expect(downstream).not.toHaveBeenCalled();
    },
  );

  it("withAuth blocks a missing profile before the route handler runs", async () => {
    const { client } = makeClient({ data: null, error: null });
    mockedCreateClient.mockResolvedValue(client);
    const downstream = vi.fn(async () => NextResponse.json({ ok: true }));
    const route = withAuth(downstream);

    const response = await route(new NextRequest("http://localhost/api/test"));

    expect(response.status).toBe(403);
    expect(downstream).not.toHaveBeenCalled();
  });

  it("withPermission blocks inactive admins before protected effects", async () => {
    const { client } = makeClient({
      data: { roles: ["admin"], status: "inactive" },
      error: null,
    });
    mockedCreateClient.mockResolvedValue(client);
    const downstream = vi.fn(async () => NextResponse.json({ ok: true }));
    const route = withPermission("users:manage", downstream);

    const response = await route(new NextRequest("http://localhost/api/test"));

    expect(response.status).toBe(403);
    expect(downstream).not.toHaveBeenCalled();
  });
});
