/** Customer portal access list and revoke route tests. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeAdminMock, type Write } from "@/test/supabase-admin-mock";

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

beforeEach(() => {
  vi.clearAllMocks();
  const mock = makeAdminMock(
    {
      customer_portal_users: ({ ops }) =>
        ops.includes("delete")
          ? { data: null, error: null }
          : {
              data: [
                {
                  user_id: "user-1",
                  created_at: "2026-07-01T12:00:00.000Z",
                },
                {
                  user_id: "user-2",
                  created_at: "2026-07-02T12:00:00.000Z",
                },
              ],
              error: null,
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

  it("revokes only the requested customer-user link", async () => {
    const response = await DELETE(
      new NextRequest(
        `http://localhost/api/customers/${CUSTOMER_ID}/portal-users/user-2`,
        { method: "DELETE" },
      ),
      {
        params: Promise.resolve({ id: CUSTOMER_ID, userId: "user-2" }),
      },
    );

    expect(response.status).toBe(200);
    expect(writes).toContainEqual({
      table: "customer_portal_users",
      op: "delete",
      row: "user-2",
    });
    await expect(response.json()).resolves.toEqual({
      data: { revoked: true, customerId: CUSTOMER_ID, userId: "user-2" },
    });
  });
});
