/**
 * Portal layout auto-link tests (audit DL-6, backlog #17).
 *
 * Pins the case-INSENSITIVE customer auto-link: migration 00201 assigns the
 * 'customer' role via lower(email) = lower(email), and Supabase lowercases
 * auth emails, so a customer stored as "Buyer@Acme.com" whose user signs in
 * as "buyer@acme.com" must still auto-link. Pre-fix, the exact `.eq("email")`
 * match missed — the user got the customer role (locked out of the staff app)
 * but no portal link, i.e. a permanently empty portal.
 *
 * The customers-table fake honors eq/ilike semantics via ilikePatternToRegex
 * (including PostgREST's *->% translation and backslash escapes), so a revert
 * to `.eq()` — or dropped pattern escaping — fails these tests outright.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  makeAdminMock,
  ilikePatternToRegex,
  type TableResponse,
  type Write,
} from "@/test/supabase-admin-mock";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

// Element is inspected via props, never rendered — mock away the client tree.
vi.mock("@/components/portal/portal-shell", () => ({
  PortalShell: () => null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));

import { createClient, createAdminClient } from "@/lib/supabase/server";
import PortalLayout from "../layout";

const mockedCreateClient = vi.mocked(createClient);
const mockedCreateAdminClient = vi.mocked(createAdminClient);

type CustomerRow = {
  id: string;
  name: string;
  email: string;
  is_active?: boolean | null;
};

type LinkRow = { customer_id: string; user_id?: string; revoked_at?: string | null };

/**
 * customers-table response honoring `.eq` (exact), `.ilike` (pattern) and the
 * active filter `.not("is_active", "is", false)` — PostgREST's spelling of
 * `COALESCE(is_active, true)`, so NULL counts as active.
 */
function customersTable(rows: CustomerRow[]): TableResponse {
  return ({ calls }) => {
    const activeOnly = calls.some(
      (c) =>
        c.method === "not"
        && c.args[0] === "is_active"
        && c.args[1] === "is"
        && c.args[2] === false,
    );
    const visible = activeOnly ? rows.filter((r) => r.is_active !== false) : rows;
    const eq = calls.find((c) => c.method === "eq" && c.args[0] === "email");
    if (eq) return { data: visible.filter((r) => r.email === eq.args[1]), error: null };
    const ilike = calls.find((c) => c.method === "ilike" && c.args[0] === "email");
    if (ilike) {
      const re = ilikePatternToRegex(String(ilike.args[1]));
      return { data: visible.filter((r) => re.test(r.email)), error: null };
    }
    return { data: visible, error: null };
  };
}

/** Every write the ADMIN client performs (junction upserts). Per-test. */
let adminWrites: Write[];

function setup(opts: {
  user: { id: string; email: string } | null;
  profile?: { data: unknown; error: unknown };
  links?: Array<LinkRow & Record<string, unknown>>;
  /** Junction rows the SERVICE-ROLE client sees, tombstones included. */
  existingLinks?: LinkRow[];
  customers?: CustomerRow[];
  linkReadError?: { message: string };
  linkWriteError?: { message: string };
  linkWriteData?: unknown;
}) {
  let linkReads = 0;
  const userMock = makeAdminMock({
    user_profiles: opts.profile ?? {
      data: { roles: ["customer"], status: "active" },
      error: null,
    },
    // Honors `.is("revoked_at", null)`: a revoked link must not be returned
    // as access when the layout filters, and IS returned when it does not.
    customer_portal_users: ({ calls }) => {
      linkReads += 1;
      const activeOnly = calls.some(
        (c) => c.method === "is" && c.args[0] === "revoked_at" && c.args[1] === null,
      );
      const rows = opts.links ?? [];
      return {
        data: activeOnly ? rows.filter((r) => r.revoked_at == null) : rows,
        error: opts.linkReadError ?? null,
      };
    },
    system_settings: { data: [], error: null },
  });
  const client = {
    ...(userMock.admin as object),
    auth: { getUser: async () => ({ data: { user: opts.user } }) },
  };
  mockedCreateClient.mockResolvedValue(client as never);

  const adminMock = makeAdminMock({
    customers: customersTable(opts.customers ?? []),
    customer_portal_users: ({ ops }) => {
      // A read (no write op) is the tombstone probe: every row for this user,
      // revoked ones included, exactly as the service role sees them.
      if (ops.length === 0) return { data: opts.existingLinks ?? [], error: null };
      return {
        data:
          opts.linkWriteData === undefined
            ? (opts.customers ?? []).map((customer) => ({
                customer_id: customer.id,
                user_id: opts.user?.id,
              }))
            : opts.linkWriteData,
        error: opts.linkWriteError ?? null,
      };
    },
  });
  adminWrites = adminMock.writes;
  mockedCreateAdminClient.mockResolvedValue(adminMock.admin as never);
  return { linkReads: () => linkReads };
}

/** Runs the async server component and exposes the PortalShell props. */
async function renderLayout() {
  return (await PortalLayout({ children: null })) as unknown as {
    props: { customers: Array<{ id: string; name: string }> };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PortalLayout customer auto-link", () => {
  it("auto-links when the stored customer email differs only in case (pre-fix lockout)", async () => {
    setup({
      user: { id: "user-1", email: "buyer@acme.com" }, // auth emails are lowercased
      customers: [{ id: "cust-1", name: "Acme Taproom", email: "Buyer@Acme.com" }],
    });

    const element = await renderLayout();

    expect(adminWrites).toContainEqual(
      expect.objectContaining({
        table: "customer_portal_users",
        op: "upsert",
        row: [{ customer_id: "cust-1", user_id: "user-1" }],
      }),
    );
    expect(element.props.customers).toEqual([{ id: "cust-1", name: "Acme Taproom" }]);
  });

  it("still auto-links an exact-case match", async () => {
    setup({
      user: { id: "user-1", email: "buyer@acme.com" },
      customers: [{ id: "cust-1", name: "Acme Taproom", email: "buyer@acme.com" }],
    });

    const element = await renderLayout();

    expect(element.props.customers).toEqual([{ id: "cust-1", name: "Acme Taproom" }]);
  });

  it("never wildcard-links: _ in the auth email must not match other characters", async () => {
    setup({
      user: { id: "user-1", email: "john_doe@acme.com" },
      customers: [{ id: "cust-2", name: "Not John", email: "johnxdoe@acme.com" }],
    });

    const element = await renderLayout();

    expect(adminWrites.filter((w) => w.table === "customer_portal_users")).toHaveLength(0);
    expect(element.props.customers).toEqual([]);
  });

  it("skips the auto-link entirely when a junction link already exists", async () => {
    setup({
      user: { id: "user-1", email: "buyer@acme.com" },
      links: [
        {
          customer_id: "cust-1",
          customers: { id: "cust-1", name: "Acme Taproom", email: "Buyer@Acme.com" },
        },
      ],
    });

    const element = await renderLayout();

    expect(mockedCreateAdminClient).not.toHaveBeenCalled();
    expect(element.props.customers).toEqual([
      { id: "cust-1", name: "Acme Taproom", email: "Buyer@Acme.com" },
    ]);
  });

  it("does not resurrect a revoked link on the revoked user's next page load", async () => {
    // Issue #605: staff revoked this link, and the portal user's auth email
    // still equals customers.email (the invite dialog's default). The layout
    // must neither render the customer nor upsert the link back.
    setup({
      user: { id: "user-1", email: "buyer@acme.com" },
      links: [
        {
          customer_id: "cust-1",
          revoked_at: "2026-07-24T12:00:00.000Z",
          customers: { id: "cust-1", name: "Acme Taproom", email: "buyer@acme.com" },
        },
      ],
      existingLinks: [
        {
          customer_id: "cust-1",
          user_id: "user-1",
          revoked_at: "2026-07-24T12:00:00.000Z",
        },
      ],
      customers: [
        { id: "cust-1", name: "Acme Taproom", email: "buyer@acme.com", is_active: true },
      ],
    });

    const element = await renderLayout();

    expect(adminWrites.filter((w) => w.table === "customer_portal_users")).toHaveLength(0);
    expect(element.props.customers).toEqual([]);
  });

  it("revoking one of several links leaves the others usable", async () => {
    setup({
      user: { id: "user-1", email: "buyer@acme.com" },
      links: [
        {
          customer_id: "cust-1",
          revoked_at: "2026-07-24T12:00:00.000Z",
          customers: { id: "cust-1", name: "Acme Taproom", email: "buyer@acme.com" },
        },
        {
          customer_id: "cust-2",
          revoked_at: null,
          customers: { id: "cust-2", name: "Beta Bottleshop", email: "buyer@acme.com" },
        },
      ],
    });

    const element = await renderLayout();

    expect(element.props.customers).toEqual([
      { id: "cust-2", name: "Beta Bottleshop", email: "buyer@acme.com" },
    ]);
    expect(mockedCreateAdminClient).not.toHaveBeenCalled();
  });

  it("never auto-links a deactivated customer", async () => {
    // POST /api/customers/[id]/invite answers 409 for is_active = false; the
    // auto-link must not be a back door around that rule (issue #605).
    setup({
      user: { id: "user-1", email: "buyer@acme.com" },
      customers: [
        { id: "cust-9", name: "Closed Bar", email: "buyer@acme.com", is_active: false },
      ],
    });

    const element = await renderLayout();

    expect(adminWrites.filter((w) => w.table === "customer_portal_users")).toHaveLength(0);
    expect(element.props.customers).toEqual([]);
  });

  it("still auto-links a genuinely first-time user of an active customer", async () => {
    setup({
      user: { id: "user-1", email: "buyer@acme.com" },
      existingLinks: [],
      customers: [
        { id: "cust-1", name: "Acme Taproom", email: "buyer@acme.com", is_active: true },
      ],
    });

    const element = await renderLayout();

    expect(adminWrites).toContainEqual(
      expect.objectContaining({
        table: "customer_portal_users",
        op: "upsert",
        // No revoked_at in the payload: an upsert that raced a concurrent
        // revoke must not clear that tombstone (PostgREST only SETs the
        // columns it was given).
        row: [{ customer_id: "cust-1", user_id: "user-1" }],
      }),
    );
    expect(element.props.customers).toEqual([{ id: "cust-1", name: "Acme Taproom" }]);
  });

  it("fails closed when the durable customer-link read fails", async () => {
    setup({
      user: { id: "user-1", email: "buyer@acme.com" },
      linkReadError: { message: "link read failed" },
    });

    await expect(renderLayout()).rejects.toMatchObject({
      message: "link read failed",
    });
    expect(mockedCreateAdminClient).not.toHaveBeenCalled();
  });

  it("does not grant in-memory access when the durable auto-link write fails", async () => {
    setup({
      user: { id: "user-1", email: "buyer@acme.com" },
      customers: [{ id: "cust-1", name: "Acme Taproom", email: "buyer@acme.com" }],
      linkWriteError: { message: "link write failed" },
    });

    await expect(renderLayout()).rejects.toMatchObject({
      message: "link write failed",
    });
  });

  it("does not grant access when an error-free auto-link returns no durable row", async () => {
    setup({
      user: { id: "user-1", email: "buyer@acme.com" },
      customers: [{ id: "cust-1", name: "Acme Taproom", email: "buyer@acme.com" }],
      linkWriteData: [],
    });

    await expect(renderLayout()).rejects.toThrow(
      "Customer portal link verification failed",
    );
  });

  it("redirects unauthenticated users to the portal login", async () => {
    setup({ user: null });

    await expect(PortalLayout({ children: null })).rejects.toThrow(
      "REDIRECT:/portal/login",
    );
  });

  it.each(["inactive", "pending"])(
    "redirects a %s portal profile before reading customer links",
    async (status) => {
      const state = setup({
        user: { id: "user-1", email: "buyer@acme.com" },
        profile: { data: { roles: ["customer"], status }, error: null },
      });

      await expect(PortalLayout({ children: null })).rejects.toThrow(
        "REDIRECT:/portal/login?error=account_disabled",
      );
      expect(state.linkReads()).toBe(0);
      expect(mockedCreateAdminClient).not.toHaveBeenCalled();
    },
  );

  it("fails closed when the portal profile is missing", async () => {
    const state = setup({
      user: { id: "user-1", email: "buyer@acme.com" },
      profile: { data: null, error: null },
    });

    await expect(PortalLayout({ children: null })).rejects.toThrow(
      "REDIRECT:/portal/login?error=account_disabled",
    );
    expect(state.linkReads()).toBe(0);
    expect(mockedCreateAdminClient).not.toHaveBeenCalled();
  });

  it("fails closed when the portal profile read errors", async () => {
    const state = setup({
      user: { id: "user-1", email: "buyer@acme.com" },
      profile: { data: null, error: { message: "read failed" } },
    });

    await expect(PortalLayout({ children: null })).rejects.toThrow(
      "REDIRECT:/portal/login?error=account_disabled",
    );
    expect(state.linkReads()).toBe(0);
    expect(mockedCreateAdminClient).not.toHaveBeenCalled();
  });
});
