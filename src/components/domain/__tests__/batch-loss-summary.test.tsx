// @vitest-environment jsdom
/**
 * Render smoke tests for BatchLossSummary (batch detail loss card).
 *
 * The volume identity itself is covered by consumption-service /
 * consumption-planning tests — this file only pins the component wiring:
 * that a positive-baseline summary renders the four figures, that planned
 * batches and baseline-less batches render nothing, and that the amber
 * over-packaged warning appears for negative loss. Follows the repo's
 * createRoot + act idiom (src/test/react-harness.ts); UnitDisplay and the
 * supabase client module are stubbed (the latter runs env validation at
 * import time).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupRenderHarness } from "@/test/react-harness";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/services/consumption-service", () => ({ getBatchLossSummary: vi.fn() }));
vi.mock("@/components/ui/unit-input", () => ({
  UnitDisplay: ({ value }: { value: number | null }) => (
    <span data-testid="vol">{value == null ? "—" : value.toFixed(2)}</span>
  ),
}));

import { getBatchLossSummary, type BatchLossSummary as Summary } from "@/services/consumption-service";
import { BatchLossSummary } from "../batch/batch-loss-summary";

const { render } = setupRenderHarness();

function makeSummary(overrides: Partial<Summary> = {}): Summary {
  return {
    producedBbl: 10,
    blendInBbl: 0,
    blendOutBbl: 0,
    baselineBbl: 10,
    packagedBbl: 8,
    attributedBbl: 0.5,
    unattributedBbl: 1.5,
    hasOpenSessions: false,
    reconciled: false,
    ...overrides,
  };
}

function mount(status: string | null, summary?: Summary) {
  vi.mocked(getBatchLossSummary).mockResolvedValue({
    success: true,
    data: summary ?? makeSummary(),
    invalidate: [],
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BatchLossSummary batchId="batch-1" status={status} />
    </QueryClientProvider>
  );
}

async function flushQuery() {
  // Let react-query resolve the mocked service promise and re-render —
  // fetching settles over macrotasks, so a bare microtask flush is not enough.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  vi.mocked(getBatchLossSummary).mockReset();
});

describe("BatchLossSummary", () => {
  it("renders produced/packaged/loss/attributed for a batch with a baseline", async () => {
    const container = mount("completed");
    await flushQuery();

    expect(container.textContent).toContain("Loss");
    expect(container.textContent).toContain("Produced wort");
    expect(container.textContent).toContain("Packaged");
    expect(container.textContent).toContain("Actual loss");
    expect(container.textContent).toContain("Attributed");
    // total loss = baseline 10 − packaged 8 = 2.00 at 20%
    expect(container.textContent).toContain("2.00");
    expect(container.textContent).toContain("20.0%");
  });

  it("renders nothing for planned batches (query disabled)", async () => {
    const container = mount("planned");
    await flushQuery();

    expect(container.textContent).toBe("");
    expect(getBatchLossSummary).not.toHaveBeenCalled();
  });

  it("renders nothing when there is no production baseline", async () => {
    const container = mount("fermenting", makeSummary({ producedBbl: 0, baselineBbl: 0 }));
    await flushQuery();

    expect(container.textContent).toBe("");
  });

  it("shows the over-packaged warning when packaged volume exceeds the baseline", async () => {
    const container = mount(
      "completed",
      makeSummary({ packagedBbl: 11, unattributedBbl: -1.5 })
    );
    await flushQuery();

    expect(container.textContent).toContain("Packaged volume exceeds produced wort");
  });

  it("labels the loss as provisional while packaging sessions are open", async () => {
    const container = mount("packaging", makeSummary({ hasOpenSessions: true }));
    await flushQuery();

    expect(container.textContent).toContain("Packaging in progress");
  });
});
