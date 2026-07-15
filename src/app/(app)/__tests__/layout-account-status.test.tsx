/** Staff layout account-status authorization regressions (issue #441). */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import { makeAdminMock } from "@/test/supabase-admin-mock";

const redirect = vi.hoisted(() => vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
}));
const createClient = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/components/domain/shared/app-sidebar", () => ({ AppSidebar: () => null }));
vi.mock("@/components/domain/shared/app-header", () => ({ AppHeader: () => null }));
vi.mock("@/components/domain/shared/app-providers", () => ({
  AppProviders: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/domain/shared/chat-layout", () => ({
  ChatLayout: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/domain/shared/command-palette", () => ({ CommandPalette: () => null }));
vi.mock("@/components/ui/sidebar", () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => children,
  SidebarInset: ({ children }: { children: React.ReactNode }) => children,
}));

import AppLayout from "../layout";

const USER = { id: "user-1", email: "user@example.com" } as User;

function setup(profile: { data: unknown; error: unknown }, user: User | null = USER) {
  let settingsReads = 0;
  const mock = makeAdminMock({
    user_profiles: profile as never,
    system_settings: () => {
      settingsReads += 1;
      return { data: [], error: null };
    },
  });
  createClient.mockResolvedValue({
    ...(mock.admin as object),
    auth: { getUser: vi.fn(async () => ({ data: { user }, error: null })) },
  });
  return { settingsReads: () => settingsReads };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AppLayout enabled-account gate", () => {
  it("renders for an active staff profile", async () => {
    setup({ data: { roles: ["admin"], status: "active" }, error: null });

    await expect(AppLayout({ children: null })).resolves.toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });

  it.each(["inactive", "pending"])(
    "redirects a %s profile before reading protected settings",
    async (status) => {
      const state = setup({ data: { roles: ["admin"], status }, error: null });

      await expect(AppLayout({ children: null })).rejects.toThrow(
        "REDIRECT:/login?error=account_disabled",
      );
      expect(state.settingsReads()).toBe(0);
    },
  );

  it("fails closed on a missing profile", async () => {
    const state = setup({ data: null, error: null });

    await expect(AppLayout({ children: null })).rejects.toThrow(
      "REDIRECT:/login?error=account_disabled",
    );
    expect(state.settingsReads()).toBe(0);
  });

  it("fails closed on a profile read error", async () => {
    const state = setup({ data: null, error: { message: "read failed" } });

    await expect(AppLayout({ children: null })).rejects.toThrow(
      "REDIRECT:/login?error=account_disabled",
    );
    expect(state.settingsReads()).toBe(0);
  });
});
