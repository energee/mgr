// @vitest-environment jsdom

/**
 * Cache-invalidation contract for `useLineItemMutations` (issue #613).
 *
 * The "Materials Required" preview on a packaging-session page is computed
 * directly from `session_line_items` (`useSessionMaterialPreview`), but it
 * caches under a sibling key namespace — `materialPlanningKeys.sessionMaterials`
 * — that a prefix invalidation of `sessionLineItemKeys.all` can never reach.
 * These tests assert against the EXACT key that query registers, so a mutation
 * path that forgets it fails here rather than silently showing pre-edit
 * needed/on-hand/shortfall numbers.
 */

import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupRenderHarness } from "@/test/react-harness";
import { materialPlanningKeys, sessionLineItemKeys } from "@/lib/query-keys";

const SESSION_ID = "00000000-0000-0000-0613-000000000001";
const ITEM_ID = "00000000-0000-0000-0613-000000000002";
const KEG_FORMAT_ID = "format-keg";
const CAN_FORMAT_ID = "format-can";

/** Chainable, awaitable Supabase stub — every terminal resolves `{ data, error }`. */
function supabaseChain() {
  const result = Promise.resolve({ data: [], error: null });
  const chain: Record<string, unknown> = {};
  chain.eq = () => chain;
  chain.select = () => chain;
  chain.then = (
    onFulfilled?: (value: { data: unknown; error: unknown }) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => result.then(onFulfilled, onRejected);
  return chain;
}

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      insert: supabaseChain,
      update: supabaseChain,
      delete: supabaseChain,
    }),
  }),
}));

vi.mock("@/hooks/use-catalog", () => ({
  usePackagingFormats: () => ({
    data: [
      { id: KEG_FORMAT_ID, container_type: "keg" },
      { id: CAN_FORMAT_ID, container_type: "can" },
    ],
  }),
}));

vi.mock("@/hooks/use-packaging", () => ({
  useKegFormatIds: () => new Set([KEG_FORMAT_ID]),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { useLineItemMutations, EMPTY_NEW_ITEM } from "@/hooks/use-session-line-items";

const { render } = setupRenderHarness();

type Mutations = ReturnType<typeof useLineItemMutations>;

function mountMutations() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });

  // Seed both caches so `isInvalidated` is observable on each.
  queryClient.setQueryData(sessionLineItemKeys.all(SESSION_ID), []);
  queryClient.setQueryData(materialPlanningKeys.sessionMaterials(SESSION_ID), []);

  let latest: Mutations | null = null;
  // Published through a plain function rather than assigned in the component
  // body (react-hooks/immutability bans the latter).
  const publish = (value: Mutations) => {
    latest = value;
  };

  function Probe({ onRender }: { onRender: (value: Mutations) => void }) {
    onRender(useLineItemMutations(SESSION_ID));
    return null;
  }

  render(
    <QueryClientProvider client={queryClient}>
      <Probe onRender={publish} />
    </QueryClientProvider>,
  );

  return { queryClient, mutations: () => latest! };
}

function invalidationState(queryClient: QueryClient) {
  return {
    lineItems: queryClient.getQueryState(sessionLineItemKeys.all(SESSION_ID))
      ?.isInvalidated,
    sessionMaterials: queryClient.getQueryState(
      materialPlanningKeys.sessionMaterials(SESSION_ID),
    )?.isInvalidated,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useLineItemMutations cache invalidation", () => {
  it("invalidates the session material preview after addItem", async () => {
    const { queryClient, mutations } = mountMutations();

    await act(async () => {
      await mutations().addItem.mutateAsync({
        ...EMPTY_NEW_ITEM,
        brand_id: "brand-1",
        format_id: CAN_FORMAT_ID,
        planned_quantity: 4800,
      });
    });

    expect(invalidationState(queryClient)).toEqual({
      lineItems: true,
      sessionMaterials: true,
    });
  });

  it("invalidates the session material preview after updateItem", async () => {
    const { queryClient, mutations } = mountMutations();

    await act(async () => {
      await mutations().updateItem.mutateAsync({
        id: ITEM_ID,
        field: "planned_quantity",
        value: 4800,
      });
    });

    expect(invalidationState(queryClient)).toEqual({
      lineItems: true,
      sessionMaterials: true,
    });
  });

  it("invalidates the session material preview after deleteItem", async () => {
    const { queryClient, mutations } = mountMutations();

    await act(async () => {
      await mutations().deleteItem.mutateAsync(ITEM_ID);
    });

    expect(invalidationState(queryClient)).toEqual({
      lineItems: true,
      sessionMaterials: true,
    });
  });

  it("invalidates the session material preview after handleFormatChange", async () => {
    const { queryClient, mutations } = mountMutations();

    await act(async () => {
      await mutations().handleFormatChange(ITEM_ID, CAN_FORMAT_ID);
    });

    expect(invalidationState(queryClient)).toEqual({
      lineItems: true,
      sessionMaterials: true,
    });
  });

  it("does not invalidate unrelated material-planning namespaces", async () => {
    const { queryClient, mutations } = mountMutations();
    queryClient.setQueryData(materialPlanningKeys.orderMaterials("order-1"), []);
    queryClient.setQueryData(
      materialPlanningKeys.shortfalls({ horizonWeeks: 4 }),
      [],
    );

    await act(async () => {
      await mutations().updateItem.mutateAsync({
        id: ITEM_ID,
        field: "planned_quantity",
        value: 4800,
      });
    });

    expect(
      queryClient.getQueryState(materialPlanningKeys.orderMaterials("order-1"))
        ?.isInvalidated,
    ).toBe(false);
    expect(
      queryClient.getQueryState(
        materialPlanningKeys.shortfalls({ horizonWeeks: 4 }),
      )?.isInvalidated,
    ).toBe(false);
  });
});
