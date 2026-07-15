/**
 * Customer portal invite route regression tests.
 *
 * The customer record has one primary email, while customer_portal_users is
 * deliberately many-to-many. Invites must therefore honor the requested
 * contact email, link that auth user to the customer, and use an operation
 * that actually sends mail when access already exists. Supabase generateLink
 * only returns a URL; it does not deliver it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  makeAdminMock,
  type TableData,
  type Write,
} from "@/test/supabase-admin-mock";

let permissionDb: ReturnType<typeof makeAdminMock>["admin"];

vi.mock("@/lib/api/auth", () => ({
  withPermission:
    (_permission: string, handler: (request: NextRequest, context: unknown) => unknown) =>
    async (
      request: NextRequest,
      routeContext?: { params?: Promise<Record<string, string>> },
    ) =>
      handler(request, {
        user: { id: "staff-1" },
        supabase: permissionDb,
        roles: ["sales"],
        permissions: ["customers:write"],
        params: routeContext?.params ? await routeContext.params : undefined,
      }),
}));

vi.mock("@/lib/api/rate-limit", () => ({
  rateLimit: () => ({ success: true, resetMs: 0 }),
  getClientIp: () => "test-ip",
}));

vi.mock("@/lib/env", () => ({ SITE_URL: "http://localhost:3000" }));

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/server";
import { POST } from "@/app/api/customers/[id]/invite/route";

const mockedCreateAdminClient = vi.mocked(createAdminClient);

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const PRIMARY_EMAIL = "owner@example.com";
const SECOND_EMAIL = "buyer@example.com";

let writes: Write[];
let createUser: ReturnType<typeof vi.fn>;
let generateLink: ReturnType<typeof vi.fn>;
let updateUserById: ReturnType<typeof vi.fn>;
let signInWithOtp: ReturnType<typeof vi.fn>;
const profileWritten = vi.fn();
const linkWritten = vi.fn();

type SetupOptions = {
  links?: Array<{ customer_id: string; user_id: string }>;
  profileRoles?: string[];
  existingProfile?: {
    id: string;
    email: string;
    roles: string[];
    status: string;
  };
  profileMissing?: boolean;
};

function setup(options: SetupOptions = {}) {
  const links = options.links ?? [];
  const tables: TableData = {
    customers: {
      data: { id: CUSTOMER_ID, email: PRIMARY_EMAIL, name: "Example Customer" },
      error: null,
    },
    system_settings: {
      data: { value: "Test Brewery" },
      error: null,
    },
    customer_portal_users: ({ ops }) => {
      if (ops.length > 0) {
        linkWritten();
        return { data: null, error: null };
      }
      return { data: links[0] ?? null, error: null };
    },
    user_profiles: ({ ops, calls }) => {
      if (ops.length > 0) {
        profileWritten();
        return { data: null, error: null };
      }
      if (calls.some((call) => call.method === "ilike")) {
        return { data: options.existingProfile ?? null, error: null };
      }
      if (options.profileMissing) return { data: null, error: null };
      return {
        data: {
          id: options.existingProfile?.id ?? "new-user-1",
          email: options.existingProfile?.email ?? SECOND_EMAIL,
          roles: options.profileRoles ?? options.existingProfile?.roles ?? ["customer"],
          status: options.existingProfile?.status ?? "active",
        },
        error: null,
      };
    },
  };

  const staff = makeAdminMock(tables, { onUnknownTable: "throw" });
  const adminMock = makeAdminMock(tables, { onUnknownTable: "throw" });
  permissionDb = staff.admin;
  writes = adminMock.writes;

  createUser = vi.fn(async ({ email }: { email: string }) => ({
    data: { user: { id: "new-user-1", email } },
    error: null,
  }));
  generateLink = vi.fn(async () => ({
    data: {
      user: { id: "existing-user-1", email: SECOND_EMAIL },
      properties: { action_link: "https://example.test/generated-but-not-sent" },
    },
    error: null,
  }));
  updateUserById = vi.fn(async () => ({ data: {}, error: null }));
  signInWithOtp = vi.fn(async () => ({ data: {}, error: null }));

  mockedCreateAdminClient.mockResolvedValue({
    ...(adminMock.admin as object),
    auth: {
      admin: { createUser, generateLink, updateUserById },
      signInWithOtp,
    },
  } as never);
}

function request(body: unknown) {
  return new NextRequest(
    `http://localhost/api/customers/${CUSTOMER_ID}/invite`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

const routeContext = {
  params: Promise.resolve({ id: CUSTOMER_ID }),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/customers/[id]/invite", () => {
  it("invites and links a second contact instead of reusing the primary email", async () => {
    setup({ profileRoles: ["viewer"] });

    const response = await POST(
      request({ email: SECOND_EMAIL, displayName: "Buyer Contact" }),
      routeContext,
    );

    expect(response.status).toBe(201);
    expect(createUser).toHaveBeenCalledWith({
      email: SECOND_EMAIL,
      email_confirm: true,
      user_metadata: {
        display_name: "Buyer Contact",
        brewery_name: "Test Brewery",
        portal_access: true,
      },
    });
    expect(writes).toContainEqual(
      expect.objectContaining({
        table: "customer_portal_users",
        op: "upsert",
        row: { customer_id: CUSTOMER_ID, user_id: "new-user-1" },
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: { email: SECOND_EMAIL, userId: "new-user-1", delivery: "otp" },
    });
    expect(signInWithOtp).toHaveBeenCalledTimes(1);
    expect(createUser.mock.invocationCallOrder[0]).toBeLessThan(
      profileWritten.mock.invocationCallOrder[0],
    );
    expect(profileWritten.mock.invocationCallOrder[0]).toBeLessThan(
      linkWritten.mock.invocationCallOrder[0],
    );
    expect(linkWritten.mock.invocationCallOrder[0]).toBeLessThan(
      signInWithOtp.mock.invocationCallOrder[0],
    );
  });

  it("sends a fresh OTP email when the portal user is already linked", async () => {
    setup({
      links: [{ customer_id: CUSTOMER_ID, user_id: "existing-user-1" }],
      existingProfile: {
        id: "existing-user-1",
        email: SECOND_EMAIL,
        roles: ["customer"],
        status: "active",
      },
    });

    const response = await POST(
      request({ email: SECOND_EMAIL }),
      routeContext,
    );

    expect(response.status).toBe(200);
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: SECOND_EMAIL,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: "http://localhost:3000/portal/orders",
      },
    });
    expect(updateUserById).toHaveBeenCalledWith("existing-user-1", {
      user_metadata: {
        brewery_name: "Test Brewery",
        portal_access: true,
      },
    });
    expect(generateLink).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: {
        email: SECOND_EMAIL,
        userId: "existing-user-1",
        delivery: "otp",
      },
    });
  });

  it("rejects an existing staff profile without changing its role or sending email", async () => {
    setup({
      existingProfile: {
        id: "staff-user-1",
        email: SECOND_EMAIL,
        roles: ["sales"],
        status: "active",
      },
    });

    await expect(
      POST(request({ email: SECOND_EMAIL }), routeContext),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("staff account"),
    });
    expect(writes).toHaveLength(0);
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("repairs an auth user whose profile trigger row is missing before emailing", async () => {
    setup({ profileMissing: true });
    createUser.mockResolvedValue({
      data: { user: null },
      error: { code: "email_exists", message: "Email already exists" },
    });

    const response = await POST(
      request({ email: SECOND_EMAIL, displayName: "Recovered Buyer" }),
      routeContext,
    );

    expect(generateLink).toHaveBeenCalledTimes(1);
    expect(writes).toContainEqual(
      expect.objectContaining({
        table: "user_profiles",
        op: "upsert",
        row: expect.objectContaining({
          id: "existing-user-1",
          email: SECOND_EMAIL,
          roles: ["customer"],
        }),
      }),
    );
    expect(signInWithOtp).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
  });
});
