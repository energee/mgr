/**
 * Tests for the customer-tier pricing service.
 *
 * Pins the contract the two former call sites (order-items-editor.tsx,
 * reorder.ts) relied on when the RPC call was inline in each of them:
 * short-circuit without a round trip when the lookup is unanswerable, and
 * collapse every "no price" outcome — empty result, RPC error, thrown client
 * — to null so callers need only one fallback branch.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

vi.mock("@/lib/client-logger", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { getPriceForCustomer } from "../pricing-service";
import { log } from "@/lib/client-logger";

type RpcResult = { data: unknown[] | null; error: unknown };

const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];

function makeClient(result: RpcResult | (() => never)) {
  return {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (typeof result === "function") return result();
      return Promise.resolve(result);
    },
  } as unknown as SupabaseClient<Database>;
}

const TIER_ROW = {
  price: 12.5,
  tier_name: "Wholesale",
  is_brand_specific: false,
  is_style_specific: false,
};

beforeEach(() => {
  calls.length = 0;
  vi.mocked(log.error).mockClear();
});

describe("getPriceForCustomer", () => {
  it("returns the first resolved tier price row", async () => {
    const client = makeClient({ data: [TIER_ROW], error: null });
    const result = await getPriceForCustomer(client, {
      customerId: "cust-1",
      sellingFormatId: "fmt-1",
      brandId: "brand-1",
      styleId: "style-1",
    });

    expect(result).toEqual(TIER_ROW);
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe("get_price_for_customer");
    expect(calls[0].args).toMatchObject({
      p_customer_id: "cust-1",
      p_format_id: "fmt-1",
      p_brand_id: "brand-1",
      p_style_id: "style-1",
    });
  });

  it("omits brand and style when they are absent or blank", async () => {
    const client = makeClient({ data: [TIER_ROW], error: null });
    await getPriceForCustomer(client, {
      customerId: "cust-1",
      sellingFormatId: "fmt-1",
      brandId: null,
      styleId: "",
    });

    // Both are DEFAULT NULL on the RPC, so "absent" and "null" are one call.
    expect(calls[0].args.p_brand_id ?? null).toBeNull();
    expect(calls[0].args.p_style_id ?? null).toBeNull();
  });

  it.each([
    ["no customer", { customerId: null, sellingFormatId: "fmt-1" }],
    ["no selling format", { customerId: "cust-1", sellingFormatId: null }],
    ["neither", { customerId: undefined, sellingFormatId: undefined }],
  ])("returns null without an RPC round trip when there is %s", async (_label, params) => {
    const client = makeClient({ data: [TIER_ROW], error: null });
    expect(await getPriceForCustomer(client, params)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("returns null when the customer has no tier price for the format", async () => {
    const client = makeClient({ data: [], error: null });
    expect(
      await getPriceForCustomer(client, { customerId: "cust-1", sellingFormatId: "fmt-1" })
    ).toBeNull();
    expect(log.error).not.toHaveBeenCalled();
  });

  it("logs and returns null on an RPC error rather than throwing", async () => {
    const client = makeClient({ data: null, error: { message: "boom" } });
    expect(
      await getPriceForCustomer(client, { customerId: "cust-1", sellingFormatId: "fmt-1" })
    ).toBeNull();
    expect(log.error).toHaveBeenCalled();
  });

  it("logs and returns null when the client throws", async () => {
    const client = makeClient(() => {
      throw new Error("network down");
    });
    expect(
      await getPriceForCustomer(client, { customerId: "cust-1", sellingFormatId: "fmt-1" })
    ).toBeNull();
    expect(log.error).toHaveBeenCalled();
  });
});
