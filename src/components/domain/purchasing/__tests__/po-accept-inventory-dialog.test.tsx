// @vitest-environment jsdom

/**
 * Cache-invalidation contract for PO "Accept into Inventory" (issue #615).
 *
 * The dialog inserts `inventory_lots` rows directly (bypassing entityService),
 * so it hand-rolls its invalidation list. Every read surface for lots — the
 * `/inventory/lots` list and detail pages — caches under the entity's
 * *view* name, `inventory_lots_with_quantities`, because the universal query
 * builders key off `viewTable ?? table`. Invalidating only
 * `entityKeys.all("inventory_lots")` therefore matched nothing at all.
 *
 * These tests assert on real cache state (`isInvalidated`) for keys built the
 * same way the list/detail pages build them, so an inert key cannot satisfy
 * them the way an `invalidateQueries` argument-list assertion would.
 */

import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupRenderHarness } from "@/test/react-harness";
import {
  binKeys,
  entityKeys,
  inventoryKeys,
  poReceiveKeys,
} from "@/lib/query-keys";
import { inventoryLotCore } from "@/entities/inventory-lot/core";

const PO_ID = "00000000-0000-0000-0615-000000000001";
const RECEIVE_ID = "00000000-0000-0000-0615-000000000002";
const ITEM_ID = "00000000-0000-0000-0615-000000000003";

const insertSpy = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => ({
      insert: (payload: unknown) => {
        insertSpy({ table, payload });
        const result = Promise.resolve({
          data: [{ id: "lot-1", po_receive_id: RECEIVE_ID }],
          error: null,
        });
        return {
          select: () => result,
          then: (
            onFulfilled?: (value: unknown) => unknown,
            onRejected?: (reason: unknown) => unknown,
          ) => result.then(onFulfilled, onRejected),
        };
      },
    }),
  }),
}));

vi.mock("@/services/types", () => ({
  dynamicRpc: () => {
    throw new Error("The test should use its preseeded query cache");
  },
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
  useIsTouch: () => false,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { POAcceptInventoryDialog } from "../po-accept-inventory-dialog";

const { render } = setupRenderHarness();

/** The exact key shape `/inventory/lots` registers (list-query-options.ts). */
const LOTS_LIST_KEY = entityKeys.pagedList(
  inventoryLotCore.viewTable!,
  {},
  {
    mode: "paged",
    from: 0,
    to: 49,
    order: [{ column: "created_at", ascending: false }],
    select: "*",
  },
);

/** The exact key an `/inventory/lots/[id]` detail page registers. */
const LOT_DETAIL_KEY = entityKeys.detail(inventoryLotCore.viewTable!, "lot-1");

function mountDialog() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
      mutations: { retry: false },
    },
  });

  queryClient.setQueryData(poReceiveKeys.unaccepted(PO_ID), [
    {
      receive_id: RECEIVE_ID,
      po_line_item_id: "line-1",
      catalog_type: "inventory_item",
      catalog_id: "catalog-1",
      catalog_name: "Pale Malt",
      quantity: 10,
      unit: "lb",
      unit_price: 1.5,
      lot_number: "LOT-1",
      expiration_date: null,
      received_date: "2026-07-25",
    },
  ]);
  queryClient.setQueryData(entityKeys.list("inventory_items"), [
    { id: ITEM_ID, name: "Pale Malt", category: "grain", unit: "lb" },
  ]);
  queryClient.setQueryData(binKeys.list({ is_active: true }), []);
  // Prefill the catalog→item mapping so the row is submittable without
  // driving the combobox.
  queryClient.setQueryData(
    poReceiveKeys.mappingDefaults(),
    new Map([
      ["inventory_item:catalog-1", { inventory_item_id: ITEM_ID, bin_id: null }],
    ]),
  );

  // Read surfaces that must go stale after acceptance.
  queryClient.setQueryData(LOTS_LIST_KEY, []);
  queryClient.setQueryData(LOT_DETAIL_KEY, {});
  queryClient.setQueryData(inventoryKeys.itemOnHand(), {});

  render(
    <QueryClientProvider client={queryClient}>
      <POAcceptInventoryDialog poId={PO_ID} open onClose={() => {}} />
    </QueryClientProvider>,
  );

  return queryClient;
}

function findByText(fragment: string) {
  return Array.from(document.body.querySelectorAll("button")).find((button) =>
    button.textContent?.includes(fragment),
  );
}

async function acceptAll() {
  const selectAll = document.body.querySelector<HTMLElement>(
    '[aria-label="Select all"]',
  );
  if (!selectAll) throw new Error("Select all checkbox not rendered");
  await act(async () => {
    selectAll.click();
  });

  const accept = findByText("Accept Selected");
  if (!accept) throw new Error("Accept button not rendered");
  await act(async () => {
    accept.click();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POAcceptInventoryDialog cache invalidation", () => {
  it("invalidates the inventory_lots view keys the lots pages actually use", async () => {
    const queryClient = mountDialog();

    await acceptAll();

    // Sanity: the acceptance really wrote lots.
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ table: "inventory_lots" }),
    );

    expect(queryClient.getQueryState(LOTS_LIST_KEY)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(LOT_DETAIL_KEY)?.isInvalidated).toBe(true);
  });

  it("invalidates the derived per-item on-hand aggregate", async () => {
    const queryClient = mountDialog();

    await acceptAll();

    expect(
      queryClient.getQueryState(inventoryKeys.itemOnHand())?.isInvalidated,
    ).toBe(true);
  });
});
