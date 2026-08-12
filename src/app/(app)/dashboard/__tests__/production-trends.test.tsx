// @vitest-environment jsdom
/**
 * Regression: MGR-K (Sentry 7597067731) — "Failed to fetch production trends"
 *
 * Pre-fix, ProductionTrends' queryFn caught the get_production_trends RPC
 * error and returned `[]`, so React Query settled the query as a *success*
 * with empty data. The dashboard silently rendered zeroed-out stat cards and
 * empty charts with no indication the fetch had failed — the only signal was
 * a Sentry log line nobody watching the page would ever see. Fixed by
 * rethrowing after logging so React Query's isError state surfaces, and the
 * component renders an explicit error message instead of a misleading empty
 * state. Follows the repo's createRoot + act idiom (src/test/react-harness.ts).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupRenderHarness } from "@/test/react-harness";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: rpcMock }) }));
vi.mock("@/hooks/use-unit-preferences", () => ({ useResolvedUnitPreferences: () => ({ volume_unit: "bbl" }) }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/client-logger", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { log } from "@/lib/client-logger";
import { ProductionTrends } from "../page";

const { render } = setupRenderHarness();

async function flushQuery() {
  // React Query settles over macrotasks, not just microtasks.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProductionTrends />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  rpcMock.mockReset();
});

describe("ProductionTrends (MGR-K regression)", () => {
  it("renders an explicit error state — not a silently-empty chart — when the RPC fails", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "connection failed", code: "57014" },
    });

    const container = mount();
    await flushQuery();

    expect(container.textContent).toContain("Couldn't load production trends");
    // Pre-fix this resolved to a zeroed "0 batches scheduled" stat card instead.
    expect(container.textContent).not.toContain("batches scheduled");
    expect(log.error).toHaveBeenCalledWith(
      "Failed to fetch production trends:",
      expect.objectContaining({ message: "connection failed" })
    );
  });
});
