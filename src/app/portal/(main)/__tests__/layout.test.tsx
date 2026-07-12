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

type CustomerRow = { id: string; name: string; email: string };

/** customers-table response honoring `.eq` (exact) and `.ilike` (pattern). */
function customersTable(rows: CustomerRow[]): TableResponse {
  return ({ calls }) => {
    const eq = calls.find((c) => c.method === "eq" && c.args[0] === "email");
    if (eq) return { data: rows.filter((r) => r.email === eq.args[1]), error: null };
    const ilike = calls.find((c) => c.method === "ilike" && c.args[0] === "email");
    if (ilike) {
      const re = ilikePatternToRegex(String(ilike.args[1]));
      return { data: rows.filter((r) => re.test(r.email)), error: null };
    }
    return { data: rows, error: null };
  };
}

/** Every write the ADMIN client performs (junction upserts). Per-test. */
let adminWrites: Write[];

function setup(opts: {
  user: { id: string; email: string } | null;
  links?: unknown[];
  customers?: CustomerRow[];
}) {
  const userMock = makeAdminMock({
    customer_portal_users: { data: opts.links ?? [], error: null },
    system_settings: { data: [], error: null },
  });
  const client = {
    ...(userMock.admin as object),
    auth: { getUser: async () => ({ data: { user: opts.user } }) },
  };
  mockedCreateClient.mockResolvedValue(client as never);

  const adminMock = makeAdminMock({
    customers: customersTable(opts.customers ?? []),
  });
  adminWrites = adminMock.writes;
  mockedCreateAdminClient.mockResolvedValue(adminMock.admin as never);
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
        row: { customer_id: "cust-1", user_id: "user-1" },
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

  it("redirects unauthenticated users to the portal login", async () => {
    setup({ user: null });

    await expect(PortalLayout({ children: null })).rejects.toThrow(
      "REDIRECT:/portal/login",
    );
  });
});
