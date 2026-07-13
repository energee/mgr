/**
 * MGR-8 regression tests: "No QueryClient set" in NotificationsProvider.
 *
 * Two layers of defense:
 *
 * 1. Structural (app-providers.tsx): AppProviders now owns its own
 *    QueryClientProvider, so NotificationsProvider always has a client
 *    regardless of outer rendering order (Turbopack RSC race condition).
 *    Tested via source inspection below.
 *
 * 2. Behavioral (notifications.tsx): NotificationsProvider guards itself
 *    via useContext(QueryClientContext), serving a no-op empty context
 *    instead of crashing if somehow rendered without a QueryClient ancestor.
 *    Tested via runtime rendering below.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect, vi } from "vitest";
import { createElement, act, useState } from "react";
import { setupRenderHarness } from "@/test/react-harness";

// ---------------------------------------------------------------------------
// Source paths for structural tests
// ---------------------------------------------------------------------------

const NOTIFICATIONS_SRC = resolve(__dirname, "../notifications.tsx");
const APP_PROVIDERS_SRC = resolve(
  __dirname,
  "../../components/domain/shared/app-providers.tsx"
);

// ---------------------------------------------------------------------------
// Mocks — must come before the module import that transitively loads them
// ---------------------------------------------------------------------------

// Prevents env-var validation in @/lib/env from throwing at import time
const limitMock = vi.fn();
const selectMock = vi.fn(() => ({ limit: limitMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));
// getUser resolves to no user so the realtime-subscription effect early-returns
// before touching supabase.channel(), which this stub does not implement.
const getUserMock = vi.fn(() => Promise.resolve({ data: { user: null } }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ from: fromMock, auth: { getUser: getUserMock } }),
}));

// Prevents @sentry/nextjs initialisation errors in jsdom
vi.mock("@/lib/client-logger", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { log } from "@/lib/client-logger";
import { NotificationsProvider, useNotifications } from "@/contexts/notifications";

// ---------------------------------------------------------------------------
// Layer 1: Structural tests (source inspection)
// ---------------------------------------------------------------------------

describe("MGR-8 regression — structural: QueryClientProvider wraps NotificationsProvider in AppProviders", () => {
  const notificationsSrc = readFileSync(NOTIFICATIONS_SRC, "utf-8");
  const appProvidersSrc = readFileSync(APP_PROVIDERS_SRC, "utf-8");

  it("notifications.tsx calls useQueryClient() — the hook that requires the provider", () => {
    expect(notificationsSrc).toContain("useQueryClient()");
  });

  it("app-providers.tsx imports QueryClientProvider from @tanstack/react-query", () => {
    expect(appProvidersSrc).toContain("QueryClientProvider");
    expect(appProvidersSrc).toContain("@tanstack/react-query");
  });

  it("app-providers.tsx opens <QueryClientProvider before <NotificationsProvider", () => {
    const queryProviderIdx = appProvidersSrc.indexOf("<QueryClientProvider");
    const notificationsProviderIdx = appProvidersSrc.indexOf("<NotificationsProvider");
    expect(queryProviderIdx).toBeGreaterThan(-1);
    expect(notificationsProviderIdx).toBeGreaterThan(-1);
    expect(queryProviderIdx).toBeLessThan(notificationsProviderIdx);
  });

  it("app-providers.tsx closes </QueryClientProvider after </NotificationsProvider", () => {
    const closeQueryIdx = appProvidersSrc.lastIndexOf("</QueryClientProvider>");
    const closeNotifIdx = appProvidersSrc.lastIndexOf("</NotificationsProvider>");
    expect(closeQueryIdx).toBeGreaterThan(-1);
    expect(closeNotifIdx).toBeGreaterThan(-1);
    expect(closeQueryIdx).toBeGreaterThan(closeNotifIdx);
  });
});

// ---------------------------------------------------------------------------
// Layer 2: Behavioral tests (runtime rendering)
// ---------------------------------------------------------------------------

const { render: renderIntoContainer } = setupRenderHarness();

function ContextDisplay() {
  const ctx = useNotifications();
  return createElement("div", null,
    createElement("span", { "data-testid": "count" }, String(ctx.unreadCount)),
    createElement("span", { "data-testid": "loading" }, String(ctx.isLoading)),
    createElement("span", { "data-testid": "notifications-length" }, String(ctx.notifications.length)),
  );
}

function ActionTester() {
  const ctx = useNotifications();
  const [result, setResult] = useState<string>("idle");

  return createElement("div", null,
    createElement("span", { "data-testid": "action-result" }, result),
    createElement("button", {
      "data-testid": "mark-read",
      onClick: () => { ctx.markAsRead("id").then(() => setResult("markAsRead-ok")).catch(() => setResult("error")); },
    }, "mark"),
    createElement("button", {
      "data-testid": "mark-all",
      onClick: () => { ctx.markAllAsRead().then(() => setResult("markAllAsRead-ok")).catch(() => setResult("error")); },
    }, "mark-all"),
    createElement("button", {
      "data-testid": "dismiss",
      onClick: () => { ctx.dismiss("id").then(() => setResult("dismiss-ok")).catch(() => setResult("error")); },
    }, "dismiss"),
  );
}

describe("MGR-8 regression — behavioral: NotificationsProvider guard renders safely without QueryClientProvider", () => {
  it("renders children without crashing when no QueryClientProvider is in the tree", () => {
    const container = renderIntoContainer(
      createElement(
        NotificationsProvider,
        null,
        createElement("span", { "data-testid": "child" }, "rendered")
      )
    );

    expect(container.querySelector('[data-testid="child"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="child"]')?.textContent).toBe("rendered");
  });

  it("provides empty fallback context values outside QueryClientProvider", () => {
    const container = renderIntoContainer(
      createElement(NotificationsProvider, null, createElement(ContextDisplay, null))
    );

    expect(container.querySelector('[data-testid="count"]')?.textContent).toBe("0");
    expect(container.querySelector('[data-testid="loading"]')?.textContent).toBe("false");
    expect(container.querySelector('[data-testid="notifications-length"]')?.textContent).toBe("0");
  });

  it("no-op action handlers resolve without throwing", async () => {
    const container = renderIntoContainer(
      createElement(NotificationsProvider, null, createElement(ActionTester, null))
    );

    const clickAndWait = async (testId: string, expected: string) => {
      await act(async () => {
        (container.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement)?.click();
      });
      expect(container.querySelector('[data-testid="action-result"]')?.textContent).toBe(expected);
    };

    await clickAndWait("mark-read", "markAsRead-ok");
    await clickAndWait("mark-all", "markAllAsRead-ok");
    await clickAndWait("dismiss", "dismiss-ok");
  });
});

// ---------------------------------------------------------------------------
// SENTRY-7597067759 regression: log.error must receive the real error
// instance, not a stripped-down primitive list, so client-logger routes it
// to Sentry.captureException (with message/stack) instead of a generic
// captureMessage.
// ---------------------------------------------------------------------------

describe("SENTRY-7597067759 regression — notifications fetch error logging", () => {
  it("forwards the real error instance to log.error, not individual primitives", async () => {
    class FakePostgrestError extends Error {
      code = "42501";
      details = "RLS denied";
    }
    const fetchError = new FakePostgrestError("permission denied");
    limitMock.mockResolvedValue({ data: null, error: fetchError });
    vi.mocked(log.error).mockClear();

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderIntoContainer(
      createElement(
        QueryClientProvider,
        { client },
        createElement(NotificationsProvider, null, createElement(ContextDisplay, null))
      )
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(log.error).toHaveBeenCalledWith("Failed to fetch notifications:", fetchError);
  });
});
