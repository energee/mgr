// @vitest-environment jsdom
/** Regression coverage for the customer change-request write boundary. */

import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupRenderHarness } from "@/test/react-harness";
import { makeSupabase, type QueuedResponse } from "@/test/supabase-mock";

const fixture = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: null as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mutationFn: null as null | (() => Promise<any>),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => fixture.supabase,
}));

vi.mock("@/contexts/portal", () => ({
  usePortalCustomer: () => ({ customerIds: ["customer-1"] }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: readonly string[] }) => {
    if (queryKey[0] === "orders") {
      return {
        data: [{
          id: "item-1",
          brand_id: "brand-1",
          selling_format_id: "format-1",
          quantity: 5,
          unit_price: 12,
          brands: { id: "brand-1", name: "Atomic Ale" },
          selling_formats: { id: "format-1", name: "Case" },
        }],
        isLoading: false,
      };
    }
    return { data: [], isLoading: false };
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useMutation: (options: any) => {
    fixture.mutationFn = options.mutationFn;
    return { mutate: vi.fn(), isPending: false };
  },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { ChangeRequestBuilder } from "../change-request-builder";

const { render } = setupRenderHarness();
const ORDER_ID = "order-1";
const RPC = "submit_order_change_request";

async function setup(rpcResponses: Record<string, QueuedResponse[]>) {
  const sb = makeSupabase({}, rpcResponses);
  fixture.supabase = sb.supabase;
  fixture.mutationFn = null;

  const container = render(<ChangeRequestBuilder orderId={ORDER_ID} />);
  const input = container.querySelector<HTMLInputElement>('input[type="number"]');
  if (!input) throw new Error("quantity input was not rendered");

  const valueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    valueSetter.call(input, "4");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  const run = fixture.mutationFn as null | (() => Promise<unknown>);
  if (!run) throw new Error("mutationFn was not registered");
  return { ...sb, run };
}

beforeEach(() => {
  fixture.mutationFn = null;
});

describe("ChangeRequestBuilder", () => {
  it("submits the parent and all items through one atomic RPC", async () => {
    const sb = await setup({ [RPC]: [{ data: "request-1", error: null }] });

    await sb.run();

    expect(sb.rpcSpy).toHaveBeenCalledTimes(1);
    expect(sb.fromSpy).not.toHaveBeenCalled();
    expect(sb.rpcSpy).toHaveBeenCalledWith(RPC, {
      p_order_id: ORDER_ID,
      p_notes: "",
      p_items: [{
        change_type: "modify",
        order_item_id: "item-1",
        brand_id: "brand-1",
        selling_format_id: "format-1",
        quantity: 4,
        original_quantity: 5,
      }],
    });
  });

  it("propagates a structured transaction rejection without table writes", async () => {
    const error = {
      code: "PT409",
      message: "Order has reached the change-request cutoff state",
    };
    const sb = await setup({ [RPC]: [{ data: null, error }] });

    await expect(sb.run()).rejects.toEqual(error);
    expect(sb.rpcSpy).toHaveBeenCalledTimes(1);
    expect(sb.fromSpy).not.toHaveBeenCalled();
  });
});
