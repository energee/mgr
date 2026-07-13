// @vitest-environment jsdom
/**
 * SENTRY-7597067759 regression: "Failed to fetch planned batches by day:"
 *
 * When the get_planned_batches_by_day RPC errors, the queryFn must forward
 * the real PostgrestError instance to log.error — not a destructured plain
 * object copy. client-logger's Sentry forwarding only routes to
 * captureException (preserving message/stack) when `instanceof Error` is
 * true; a plain object silently degrades to a generic captureMessage with
 * no diagnostic detail, which is exactly what produced this issue.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupRenderHarness } from "@/test/react-harness";

const rpcMock = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: rpcMock }),
}));
vi.mock("@/lib/client-logger", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { log } from "@/lib/client-logger";
import { BatchActivityHeatmap } from "../batch-activity-heatmap";

const { render } = setupRenderHarness();

async function flushQuery() {
  // Fetching settles over macrotasks, so a bare microtask flush is not enough
  // (mirrors src/components/domain/__tests__/batch-loss-summary.test.tsx).
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  rpcMock.mockReset();
  vi.mocked(log.error).mockReset();
});

describe("BatchActivityHeatmap — RPC error logging", () => {
  it("forwards the real PostgrestError instance to log.error, not a stripped copy", async () => {
    class FakePostgrestError extends Error {
      code = "42501";
      details = "RLS denied";
      hint = "check policies";
    }
    const rpcError = new FakePostgrestError("permission denied for function");
    rpcMock.mockResolvedValue({ data: null, error: rpcError });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <BatchActivityHeatmap />
      </QueryClientProvider>
    );
    await flushQuery();

    expect(log.error).toHaveBeenCalledWith(
      "Failed to fetch planned batches by day:",
      rpcError,
    );
  });
});
