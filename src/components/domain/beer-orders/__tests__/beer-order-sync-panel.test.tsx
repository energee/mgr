// @vitest-environment jsdom
/** UI guard: unresolved mappings can be previewed but never applied. */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setupRenderHarness } from "@/test/react-harness";
import { BeerOrderSyncPanel } from "../beer-order-sync-panel";

const summary = {
  sourceOrders: 1,
  sourceLines: 1,
  plannedOrders: 0,
  plannedLines: 0,
  createdOrders: 0,
  updatedOrders: 0,
  unchangedOrders: 0,
  customersToCreate: 0,
  staleOrders: 0,
  skippedInternalBlocks: 1,
  skippedInactiveBlocks: 0,
};

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());
const { render } = setupRenderHarness();

async function flushUpdates() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("BeerOrderSyncPanel", () => {
  it("shows history request failures instead of an empty-history message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: { message: "Import tables are unavailable" },
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = render(
      <QueryClientProvider client={queryClient}>
        <BeerOrderSyncPanel />
      </QueryClientProvider>,
    );

    await flushUpdates();

    expect(container.textContent).toContain("Import history unavailable");
    expect(container.textContent).not.toContain("No spreadsheet imports yet.");
    expect([...container.querySelectorAll("button")].some(
      (button) => button.textContent?.trim() === "Retry",
    )).toBe(true);
  });

  it("keeps apply unavailable until every unknown customer and beer is mapped", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/runs")) return jsonResponse([]);
      return jsonResponse({
        runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        filename: "Beer orders.xlsx",
        sha256: "a".repeat(64),
        plan: {
          version: 1,
          ready: false,
          summary,
          unresolved: {
            customers: [{ sourceKey: "new distributor", sourceLabel: "New Distributor" }],
            brands: [{
              sourceKey: "future beer",
              sourceLabel: "Future Beer",
              brandId: null,
              requiresBrand: true,
              requiresTier: true,
            }],
          },
          options: { customers: [], brands: [] },
          customersToCreate: [],
          customerMappings: [],
          brandMappings: [],
          orders: [],
          staleOrders: [],
        },
      });
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = render(
      <QueryClientProvider client={queryClient}>
        <BeerOrderSyncPanel />
      </QueryClientProvider>,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    Object.defineProperty(input!, "files", {
      value: [new File(["orders"], "Beer orders.xlsx")],
      configurable: true,
    });
    await act(async () => input!.dispatchEvent(new Event("change", { bubbles: true })));
    const previewButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Preview reconciliation"),
    );
    expect(previewButton).toBeDefined();
    await act(async () => previewButton!.click());
    await flushUpdates();

    expect(container.textContent).toContain("Resolve mappings");
    const applyButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Apply reconciliation",
    );
    expect(applyButton).toBeUndefined();
    const repreviewButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Re-run preview with mappings"),
    );
    expect(repreviewButton).toBeDefined();
    expect(repreviewButton).toBeDisabled();
  });
});
