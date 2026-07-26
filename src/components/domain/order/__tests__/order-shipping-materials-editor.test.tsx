// @vitest-environment jsdom

/**
 * Regression coverage for the Shipping Materials row-input resync (issue #614).
 *
 * `MaterialRow` seeds its Actual input from server state with `useState` and
 * never resyncs. Once the approve path started invalidating
 * `materialPlanningKeys.orderMaterials`, a refetch could change
 * `estimated_qty` under a row that kept its stale seed — and the blur guard
 * compares the stale seed against the *fresh* row, so merely tabbing through
 * an untouched field would persist the old number as a manual `actual_qty`
 * override. `recalculate_order_materials` deliberately preserves overrides
 * (migration 00265), so that write never self-heals.
 */

import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupRenderHarness } from "@/test/react-harness";

const ORDER_ID = "00000000-0000-0000-0614-000000000001";
const MATERIAL_ROW_ID = "00000000-0000-0000-0614-000000000002";

const updateSpy = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ marker: "browser-client" }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// The query hook is stubbed per-test so we control the "server" rows directly;
// `dynamicFrom` is the editor's write path, spied to detect a persisted override.
const materialsRef: { current: unknown[] } = { current: [] };

vi.mock("@/hooks/use-material-planning", () => ({
  useOrderMaterials: () => ({ data: materialsRef.current, isLoading: false }),
}));

vi.mock("@/services/types", () => ({
  dynamicFrom: (_client: unknown, table: string) => ({
    update: (payload: unknown) => ({
      eq: (_column: string, id: string) => {
        updateSpy({ table, payload, id });
        return Promise.resolve({ data: null, error: null });
      },
    }),
  }),
}));

import { OrderShippingMaterialsEditor } from "../order-shipping-materials-editor";

const { render, rerender } = setupRenderHarness();

function materialRow(estimated: number) {
  return {
    id: MATERIAL_ROW_ID,
    order_id: ORDER_ID,
    inventory_item_id: "item-1",
    estimated_qty: estimated,
    actual_qty: null,
    inventory_item: { id: "item-1", name: "Pallet", category: "shipping", unit: "ea" },
  };
}

function tree() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <OrderShippingMaterialsEditor orderId={ORDER_ID} />
    </QueryClientProvider>
  );
}

function actualInput(container: HTMLElement) {
  const input = container.querySelector<HTMLInputElement>('input[type="number"]');
  if (!input) throw new Error("Actual input not rendered");
  return input;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OrderShippingMaterialsEditor row resync", () => {
  it("shows the recomputed estimate after a refetch changes it", () => {
    materialsRef.current = [materialRow(1)];
    const container = render(tree());
    expect(actualInput(container).value).toBe("1");

    // Approval recomputed the estimate server-side; the refetch delivers 2.
    materialsRef.current = [materialRow(2)];
    rerender(tree());

    expect(actualInput(container).value).toBe("2");
  });

  it("does not persist an override when an untouched input is blurred after a refetch", async () => {
    materialsRef.current = [materialRow(1)];
    const container = render(tree());

    materialsRef.current = [materialRow(2)];
    rerender(tree());

    // React delegates onBlur from the bubbling `focusout` event, not `blur`.
    // The mutationFn is async, so the act() must be awaited to flush it.
    await act(async () => {
      actualInput(container).dispatchEvent(
        new FocusEvent("focusout", { bubbles: true }),
      );
    });

    expect(updateSpy).not.toHaveBeenCalled();
  });
});
