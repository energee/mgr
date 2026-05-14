/**
 * Regression test for MGR-8: "No QueryClient set" in NotificationsProvider.
 *
 * Root cause: AppProviders relied on the root Providers layout to supply
 * QueryClientProvider, but Turbopack dev-mode can process the async (app) layout's
 * client subtree before that outer context is established.
 *
 * Fix: AppProviders now owns its own QueryClientProvider so that
 * NotificationsProvider always has a client regardless of render order.
 *
 * These source-inspection tests verify:
 *   1. notifications.tsx still calls useQueryClient() — the vulnerable pattern.
 *   2. app-providers.tsx imports QueryClientProvider — the guard is present.
 *   3. QueryClientProvider opens before NotificationsProvider in AppProviders JSX
 *      — so it always wraps the component that calls useQueryClient().
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect } from "vitest";

const NOTIFICATIONS_SRC = resolve(__dirname, "../notifications.tsx");
const APP_PROVIDERS_SRC = resolve(
  __dirname,
  "../../components/domain/app-providers.tsx"
);

describe("MGR-8 regression — NotificationsProvider always inside QueryClientProvider", () => {
  const notificationsSrc = readFileSync(NOTIFICATIONS_SRC, "utf-8");
  const appProvidersSrc = readFileSync(APP_PROVIDERS_SRC, "utf-8");

  it("notifications.tsx calls useQueryClient() — the hook that requires the provider", () => {
    expect(notificationsSrc).toContain("useQueryClient()");
  });

  it("app-providers.tsx imports QueryClientProvider from @tanstack/react-query", () => {
    expect(appProvidersSrc).toContain("QueryClientProvider");
    expect(appProvidersSrc).toContain("@tanstack/react-query");
  });

  // Source-text heuristic (same pattern as recipe-editor-page-definition-order.test.ts):
  // checks character positions, not AST structure. Catches the common regression.
  it("app-providers.tsx opens <QueryClientProvider before <NotificationsProvider (ensures wrapping)", () => {
    const queryProviderIdx = appProvidersSrc.indexOf("<QueryClientProvider");
    const notificationsProviderIdx = appProvidersSrc.indexOf("<NotificationsProvider");
    expect(queryProviderIdx).toBeGreaterThan(-1);
    expect(notificationsProviderIdx).toBeGreaterThan(-1);
    // QueryClientProvider must open before NotificationsProvider so it wraps it
    expect(queryProviderIdx).toBeLessThan(notificationsProviderIdx);
  });

  it("app-providers.tsx closes </QueryClientProvider after </NotificationsProvider (ensures full wrapping)", () => {
    const closeQueryIdx = appProvidersSrc.lastIndexOf("</QueryClientProvider>");
    const closeNotifIdx = appProvidersSrc.lastIndexOf("</NotificationsProvider>");
    expect(closeQueryIdx).toBeGreaterThan(-1);
    expect(closeNotifIdx).toBeGreaterThan(-1);
    // The closing tag for QueryClientProvider must be after the closing tag for NotificationsProvider
    expect(closeQueryIdx).toBeGreaterThan(closeNotifIdx);
  });
});
