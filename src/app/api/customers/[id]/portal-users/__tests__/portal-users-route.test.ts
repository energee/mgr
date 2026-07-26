/**
 * Customer portal access list and revoke route tests.
 *
 * Revocation is a tombstone (`revoked_at`), not a delete: the portal layout's
 * service-role auto-link re-created a hard-deleted row on the revoked user's
 * next page load (issue #605), so the row must survive as durable evidence of
 * the staff decision, and every reader must filter it out.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  makeAdminMock,
  type ChainCall,
  type Write,
} from "@/test/supabase-admin-mock";

vi.mock("@/lib/api/auth", () => ({
  withPermission:
    (_permission: string, handler: (request: NextRequest, context: unknown) => unknown) =>
    async (
      request: NextRequest,
      routeContext?: { params?: Promise<Record<string, string>> },
    ) =>
      handler(request, {
        user: { id: "staff-1" },
        roles: ["sales"],
        permissions: ["customers:read", "customers:write"],
        params: routeContext?.params ? await routeContext.params : undefined,
      }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/server";
import { GET } from "@/app/api/customers/[id]/portal-users/route";
import { DELETE } from "@/app/api/customers/[id]/portal-users/[userId]/route";

const mockedCreateAdminClient = vi.mocked(createAdminClient);
const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
let writes: Write[];
/** Chain calls recorded per customer_portal_users builder, in call order. */
let portalChains: ChainCall[][];

/** user-3 is already revoked: the list must not report it as access. */
const LINK_ROWS = [
  { user_id: "user-1", created_at: "2026-07-01T12:00:00.000Z", revoked_at: null },
  { user_id: "user-2", created_at: "2026-07-02T12:00:00.000Z", revoked_at: null },
  {
    user_id: "user-3",
    created_at: "2026-07-03T12:00:00.000Z",
    revoked_at: "2026-07-20T12:00:00.000Z",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  portalChains = [];
  const mock = makeAdminMock(
    {
      customer_portal_users: ({ ops, calls }) => {
        portalChains.push(calls);
        if (ops.length > 0) return { data: null, error: null };
        const activeOnly = calls.some(
          (c) => c.method === "is" && c.args[0] === "revoked_at" && c.args[1] === null,
        );
        return {
          data: activeOnly
            ? LINK_ROWS.filter((row) => row.revoked_at == null)
            : LINK_ROWS,
          error: null,
        };
      },
      user_profiles: {
        data: [
          {
            id: "user-1",
            email: "owner@example.com",
            display_name: "Owner",
            status: "active",
            last_active_at: "2026-07-14T12:00:00.000Z",
          },
          {
            id: "user-2",
            email: "buyer@example.com",
            display_name: "Buyer",
            status: "active",
            last_active_at: null,
          },
          {
            id: "user-3",
            email: "departed@example.com",
            display_name: "Departed Buyer",
            status: "active",
            last_active_at: null,
          },
        ],
        error: null,
      },
    },
    { onUnknownTable: "throw" },
  );
  writes = mock.writes;
  mockedCreateAdminClient.mockResolvedValue(mock.admin as never);
});

describe("customer portal users API", () => {
  it("lists every linked profile without reading auth.users", async () => {
    const response = await GET(
      new NextRequest(
        `http://localhost/api/customers/${CUSTOMER_ID}/portal-users`,
      ),
      { params: Promise.resolve({ id: CUSTOMER_ID }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [
        {
          userId: "user-1",
          email: "owner@example.com",
          displayName: "Owner",
          status: "active",
          lastActiveAt: "2026-07-14T12:00:00.000Z",
          accessGrantedAt: "2026-07-01T12:00:00.000Z",
        },
        {
          userId: "user-2",
          email: "buyer@example.com",
          displayName: "Buyer",
          status: "active",
          lastActiveAt: null,
          accessGrantedAt: "2026-07-02T12:00:00.000Z",
        },
      ],
    });
  });

  it("omits revoked links from the access list", async () => {
    const response = await GET(
      new NextRequest(
        `http://localhost/api/customers/${CUSTOMER_ID}/portal-users`,
      ),
      { params: Promise.resolve({ id: CUSTOMER_ID }) },
    );

    const body = (await response.json()) as { data: Array<{ userId: string }> };
    expect(body.data.map((entry) => entry.userId)).toEqual(["user-1", "user-2"]);
  });

  function revoke(userId: string) {
    return DELETE(
      new NextRequest(
        `http://localhost/api/customers/${CUSTOMER_ID}/portal-users/${userId}`,
        { method: "DELETE" },
      ),
      { params: Promise.resolve({ id: CUSTOMER_ID, userId }) },
    );
  }

  it("tombstones the requested link instead of deleting the row", async () => {
    const response = await revoke("user-2");

    expect(response.status).toBe(200);
    // A hard delete leaves no record of the staff decision, and the portal
    // layout's service-role auto-link then re-creates the link (issue #605).
    expect(writes.filter((write) => write.op === "delete")).toEqual([]);
    expect(writes).toContainEqual(
      expect.objectContaining({
        table: "customer_portal_users",
        op: "update",
        row: expect.objectContaining({ revoked_at: expect.any(String) }),
      }),
    );
    await expect(response.json()).resolves.toEqual({
      data: { revoked: true, customerId: CUSTOMER_ID, userId: "user-2" },
    });
  });

  it("scopes the tombstone to one customer-user pair that is not already revoked", async () => {
    await revoke("user-2");

    const chain = portalChains.at(-1) ?? [];
    expect(chain).toContainEqual({ method: "eq", args: ["customer_id", CUSTOMER_ID] });
    expect(chain).toContainEqual({ method: "eq", args: ["user_id", "user-2"] });
    expect(chain).toContainEqual({ method: "is", args: ["revoked_at", null] });
  });

  it("is idempotent: revoking an already-revoked link still succeeds", async () => {
    await revoke("user-3");
    const response = await revoke("user-3");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { revoked: true, customerId: CUSTOMER_ID, userId: "user-3" },
    });
    expect(writes.filter((write) => write.op === "delete")).toEqual([]);
  });
});
