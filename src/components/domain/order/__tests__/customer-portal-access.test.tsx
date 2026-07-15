// @vitest-environment jsdom
/** Customer portal access manager render tests. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupRenderHarness } from "@/test/react-harness";

const fixtures = vi.hoisted(() => ({
  canManage: true,
  users: [] as Array<{
    userId: string;
    email: string | null;
    displayName: string | null;
    status: string | null;
    lastActiveAt: string | null;
    accessGrantedAt: string;
  }>,
  isLoading: false,
  isError: false,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: fixtures.users,
    isLoading: fixtures.isLoading,
    isError: fixtures.isError,
  }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/contexts/permissions", () => ({
  usePermissions: () => ({
    can: () => fixtures.canManage,
  }),
}));

vi.mock("@/entities/user-profile", () => ({
  userProfileEntity: {
    stateMachine: {
      stateDisplay: {
        active: { label: "Active", color: "success" },
        inactive: { label: "Inactive", color: "default" },
      },
    },
  },
}));

import { CustomerPortalAccess } from "../customer-portal-access";

const { render } = setupRenderHarness();

beforeEach(() => {
  fixtures.canManage = true;
  fixtures.users = [];
  fixtures.isLoading = false;
  fixtures.isError = false;
});

describe("CustomerPortalAccess", () => {
  it("lists every linked contact with independent resend and remove actions", () => {
    fixtures.users = [
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
    ];

    const container = render(
      <CustomerPortalAccess customerId="customer-1" primaryEmail="owner@example.com" />,
    );

    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(container.textContent).toContain("owner@example.com");
    expect(container.textContent).toContain("buyer@example.com");
    expect(container.querySelectorAll("button")).toHaveLength(5);
    expect(
      container.querySelector(
        'button[aria-label="Remove portal access for buyer@example.com"]',
      ),
    ).not.toBeNull();
  });

  it("shows the invite action and an empty state before access is granted", () => {
    const container = render(
      <CustomerPortalAccess customerId="customer-1" primaryEmail="owner@example.com" />,
    );

    expect(container.textContent).toContain("Invite portal user");
    expect(container.textContent).toContain("No one has portal access yet");
  });

  it("keeps linked users visible but hides management actions without write permission", () => {
    fixtures.canManage = false;
    fixtures.users = [
      {
        userId: "user-1",
        email: "owner@example.com",
        displayName: "Owner",
        status: "active",
        lastActiveAt: null,
        accessGrantedAt: "2026-07-01T12:00:00.000Z",
      },
    ];

    const container = render(
      <CustomerPortalAccess customerId="customer-1" primaryEmail="owner@example.com" />,
    );

    expect(container.textContent).toContain("owner@example.com");
    expect(container.textContent).not.toContain("Invite portal user");
    expect(container.textContent).not.toContain("Resend");
    expect(container.querySelector("button")).toBeNull();
  });
});
