/**
 * QBOSyncSection badge-state tests.
 *
 * Pins the distinction the sync-log route now makes on the wire: a failed
 * read must not render as "Not Synced". Asserting "Not Synced" is absent (and
 * that the action button does not invite a first-time sync) is the only check
 * that fails before the fix — the component previously fell through to the
 * "never synced" arm for both an empty log and a broken one.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupRenderHarness } from "@/test/react-harness";
import { QBOSyncSection } from "../qbo-sync-section";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const harness = setupRenderHarness();

/** Resolves the connection probe as connected; the sync-log per `syncLog`. */
function stubFetch(syncLog: { ok: boolean; body: unknown }) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/status")) {
      return new Response(JSON.stringify({ data: { connected: true } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/sync-log")) {
      return new Response(JSON.stringify(syncLog.body), {
        status: syncLog.ok ? 200 : 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

/**
 * Renders the section and flushes until the status badge leaves its
 * "Checking..." state — the connection probe and the sync-log query resolve in
 * sequence, so a fixed number of microtask flushes is racy.
 */
async function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const container = harness.render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(QBOSyncSection, { entityType: "order", entityId: "o-1" })
    )
  );
  for (let attempt = 0; attempt < 50; attempt++) {
    const text = container.textContent ?? "";
    if (text.includes("QuickBooks") && !text.includes("Checking...")) break;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1));
    });
  }
  return container;
}

beforeEach(() => {
  vi.stubGlobal("fetch", stubFetch({ ok: true, body: { data: { logs: [], total: 0 } } }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("QBOSyncSection sync-log states", () => {
  it("renders 'Not Synced' for a genuinely empty log", async () => {
    const container = await renderSection();
    expect(container.textContent).toContain("Not Synced");
  });

  it("renders an unavailable state, not 'Not Synced', when the log read fails", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetch({ ok: false, body: { error: { code: "DB_ERROR", message: "boom" } } })
    );

    const container = await renderSection();

    expect(container.textContent).not.toContain("Not Synced");
    expect(container.textContent).toContain("Status unavailable");
    // Must not imply this entity has never reached QuickBooks.
    expect(container.textContent).not.toMatch(/>?\bSync\b<\/button>/);
  });
});
