// @vitest-environment jsdom
/** Regression coverage for fail-closed planned recipe additions loading. */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupRenderHarness } from "@/test/react-harness";
import { makeSupabase, type QueuedResponse } from "@/test/supabase-mock";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/lib/client-logger", () => ({
  log: {
    error: mocks.logError,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { PlannedAdditions } from "../planned-additions";

type SourceTable =
  | "recipe_hops"
  | "recipe_fruits"
  | "recipe_spices"
  | "recipe_adjuncts";

const sourceCases = [
  ["recipe_hops", "dry hops", "Citra"],
  ["recipe_fruits", "fruits", "Mango"],
  ["recipe_spices", "spices", "Coriander"],
  ["recipe_adjuncts", "adjuncts", "Honey"],
] as const satisfies ReadonlyArray<readonly [SourceTable, string, string]>;

const successfulRows: Record<SourceTable, unknown[]> = {
  recipe_hops: [
    {
      id: "hop-1",
      hop_id: "catalog-hop-1",
      weight_oz: 8,
      notes: null,
      hop: { name: "Citra" },
    },
  ],
  recipe_fruits: [
    {
      id: "fruit-1",
      fruit_id: "catalog-fruit-1",
      amount: 10,
      unit: "lb",
      timing: "secondary",
      notes: null,
      fruit: { name: "Mango" },
    },
  ],
  recipe_spices: [
    {
      id: "spice-1",
      spice_id: "catalog-spice-1",
      amount: 2,
      unit: "oz",
      timing: "fermentation",
      notes: null,
      spice: { name: "Coriander" },
    },
  ],
  recipe_adjuncts: [
    {
      id: "adjunct-1",
      adjunct_id: "catalog-adjunct-1",
      weight_lbs: 5,
      notes: null,
      adjunct: { name: "Honey" },
    },
  ],
};

const { render } = setupRenderHarness();

function responsesWithFailure(
  failingTable?: SourceTable,
): Record<SourceTable, QueuedResponse[]> {
  return Object.fromEntries(
    sourceCases.map(([table]) => [
      table,
      [
        table === failingTable
          ? {
              data: null,
              error: {
                code: "42501",
                details: "RLS denied",
                hint: null,
                message: `${table} denied`,
              },
            }
          : { data: successfulRows[table], error: null },
      ],
    ]),
  ) as Record<SourceTable, QueuedResponse[]>;
}

function mount(responses: Record<SourceTable, QueuedResponse[]>) {
  const { supabase } = makeSupabase(responses);
  mocks.createClient.mockReturnValue(supabase);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <PlannedAdditions recipeId="recipe-1" actualAdditions={[]} />
    </QueryClientProvider>,
  );
}

async function flushQuery() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  mocks.createClient.mockReset();
  mocks.logError.mockReset();
});

describe("PlannedAdditions", () => {
  it.each(sourceCases)(
    "fails closed with source context when %s cannot be read",
    async (failingTable, sourceLabel) => {
      const container = mount(responsesWithFailure(failingTable));

      await flushQuery();

      expect(container.textContent).toContain("Failed to load planned additions");
      for (const [, , additionName] of sourceCases) {
        expect(container.textContent).not.toContain(additionName);
      }
      expect(mocks.logError).toHaveBeenCalledWith(
        `Failed to load planned ${sourceLabel}:`,
        expect.objectContaining({ message: `${failingTable} denied` }),
      );
    },
  );

  it("combines every successful planned-addition source", async () => {
    const container = mount(responsesWithFailure());

    await flushQuery();

    expect(container.textContent).toContain("Planned from Recipe");
    expect(container.textContent).toContain("0/4 complete");
    for (const [, , additionName] of sourceCases) {
      expect(container.textContent).toContain(additionName);
    }
    expect(container.textContent).not.toContain("Failed to load planned additions");
    expect(mocks.logError).not.toHaveBeenCalled();
  });
});
