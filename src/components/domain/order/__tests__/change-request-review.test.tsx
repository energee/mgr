// @vitest-environment jsdom

import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupRenderHarness } from "@/test/react-harness";
import {
  changeRequestKeys,
  entityKeys,
  materialPlanningKeys,
} from "@/lib/query-keys";

const toastSuccess = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ marker: "browser-client" }),
}));
vi.mock("@/services/types", () => ({
  dynamicFrom: vi.fn(() => {
    throw new Error("The test should use its preseeded query cache");
  }),
}));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: vi.fn() },
}));

import { ChangeRequestReview } from "../change-request-review";

const { render } = setupRenderHarness();

const ORDER_ID = "00000000-0000-0000-0476-000000000001";
const REQUEST_ID = "00000000-0000-0000-0476-000000000002";

function renderReview() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  queryClient.setQueryData(changeRequestKeys.pendingForOrder(ORDER_ID), {
    id: REQUEST_ID,
    status: "pending",
    notes: null,
    created_at: "2026-07-15T12:00:00.000Z",
    requested_by: "customer-1",
    order_change_request_items: [{
      id: "change-item-1",
      change_type: "add",
      order_item_id: null,
      brand_id: "brand-1",
      selling_format_id: "format-1",
      quantity: 4,
      original_quantity: null,
      brands: { name: "Test IPA" },
      selling_formats: { name: "24-pack" },
    }],
  });
  queryClient.setQueryData(
    entityKeys.detail("order_items_for_review", ORDER_ID),
    [],
  );
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

  const container = render(
    <QueryClientProvider client={queryClient}>
      <ChangeRequestReview parentId={ORDER_ID} />
    </QueryClientProvider>,
  );

  return { container, invalidateSpy };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue({ data: { approved: true } }),
  }));
});

describe("ChangeRequestReview approval", () => {
  it("refreshes every local order projection changed by approval", async () => {
    const { container, invalidateSpy } = renderReview();
    const approveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Approve"),
    );
    expect(approveButton).toBeDefined();

    await act(async () => {
      approveButton!.click();
    });

    expect(fetch).toHaveBeenCalledWith(
      `/api/orders/${ORDER_ID}/change-requests/${REQUEST_ID}/approve`,
      { method: "POST" },
    );
    // Exhaustive, not an allow-list: an allow-list of `toHaveBeenCalledWith`
    // assertions cannot fail when a *required* key is missing, which is how
    // `materialPlanningKeys.orderMaterials` stayed absent (issue #614).
    // Approval rewrites `order_items` server-side, and the
    // `trg_order_items_recalculate_materials` trigger recomputes
    // `order_materials`, so the Shipping Materials table on the same pane must
    // be refreshed too.
    const invalidatedKeys = invalidateSpy.mock.calls.map((call) =>
      JSON.stringify(call[0]?.queryKey),
    );
    expect(new Set(invalidatedKeys)).toEqual(
      new Set(
        [
          changeRequestKeys.forOrder(ORDER_ID),
          changeRequestKeys.pendingForOrder(ORDER_ID),
          entityKeys.all("orders"),
          entityKeys.all("order_list_details"),
          entityKeys.detail("order_items_for_review", ORDER_ID),
          materialPlanningKeys.orderMaterials(ORDER_ID),
        ].map((key) => JSON.stringify(key)),
      ),
    );
    expect(toastSuccess).toHaveBeenCalledWith("Change request approved");
  });
});
