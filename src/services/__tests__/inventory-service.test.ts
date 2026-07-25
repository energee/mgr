// @vitest-environment node
/**
 * inventoryService.getExpiringLots tests
 *
 * Regression guard for F-143. The dashboard and chat tool both used to
 * reimplement this query inline against the wrong column:
 *   - dashboard filtered `quantity > 0` on inventory_lots (the *received*
 *     quantity, immutable after insert), so fully-allocated lots showed
 *     up as "expiring soon".
 *   - chat tool filtered `available_quantity > 0` on
 *     inventory_lots_with_quantities, but that view exposes
 *     `remaining_quantity` only — the filter was a silent no-op.
 *
 * These tests pin the service to the correct view + column and verify the
 * limit parameter the dashboard caller relies on.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

import { inventoryService } from "../inventory-service";

type Call = { method: string; args: unknown[] };

/**
 * Chainable Supabase builder mock. All filter methods record their call and
 * return `this`. `then` resolves with the supplied `{ data, error }` so
 * `await builder` works the same as a real PostgREST builder.
 */
function createMockBuilder(finalResult: { data: unknown; error: unknown }) {
  const calls: Call[] = [];
  const chainMethods = ["select", "not", "lte", "gt", "order", "eq", "in", "limit"];
  const builder: Record<string, unknown> = {};

  for (const m of chainMethods) {
    builder[m] = vi.fn((...args: unknown[]) => {
      calls.push({ method: m, args });
      return builder;
    });
  }

  builder.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(finalResult).then(resolve);

  return { builder, calls };
}

function createMockSupabase(finalResult: { data: unknown; error: unknown }) {
  const { builder, calls } = createMockBuilder(finalResult);
  const fromCalls: string[] = [];

  const client = {
    from: vi.fn((table: string) => {
      fromCalls.push(table);
      return builder;
    }),
  } as unknown as SupabaseClient<Database>;

  return { client, calls, fromCalls };
}

/**
 * A client whose builder REJECTS rather than resolving `{ data, error }` —
 * models a transport-level failure (fetch aborted, client throws) rather than
 * a PostgREST error payload, which is what the service's catch block exists
 * for. `reason` is deliberately `unknown`: the catch has to survive a
 * non-Error rejection too.
 */
function createRejectingSupabase(reason: unknown) {
  const chainMethods = ["select", "not", "lte", "gt", "order", "eq", "in", "limit"];
  const builder: Record<string, unknown> = {};
  for (const m of chainMethods) {
    builder[m] = vi.fn(() => builder);
  }
  builder.then = (_resolve: unknown, reject: (e: unknown) => unknown) =>
    Promise.reject(reason).catch(reject);

  return {
    client: { from: vi.fn(() => builder) } as unknown as SupabaseClient<Database>,
  };
}

describe("inventoryService.getExpiringLots", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-13T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("queries the inventory_lots_with_quantities view, not the base table", async () => {
    const { client, fromCalls } = createMockSupabase({ data: [], error: null });
    await inventoryService.getExpiringLots(client, 90);
    expect(fromCalls).toContain("inventory_lots_with_quantities");
    expect(fromCalls).not.toContain("inventory_lots");
  });

  it("filters on remaining_quantity > 0 (the consumption-aware column)", async () => {
    const { client, calls } = createMockSupabase({ data: [], error: null });
    await inventoryService.getExpiringLots(client, 90);

    const gtCalls = calls.filter((c) => c.method === "gt");
    expect(gtCalls.map((c) => c.args[0])).toEqual(["remaining_quantity"]);
    expect(gtCalls[0].args[1]).toBe(0);

    // Common-mistake guards.
    for (const gt of gtCalls) {
      expect(gt.args[0]).not.toBe("quantity");
      expect(gt.args[0]).not.toBe("available_quantity");
    }
  });

  it("applies the requested limit when provided", async () => {
    const { client, calls } = createMockSupabase({ data: [], error: null });
    await inventoryService.getExpiringLots(client, 90, 20);

    const limitCalls = calls.filter((c) => c.method === "limit");
    expect(limitCalls).toHaveLength(1);
    expect(limitCalls[0].args[0]).toBe(20);
  });

  it("omits limit when not provided", async () => {
    const { client, calls } = createMockSupabase({ data: [], error: null });
    await inventoryService.getExpiringLots(client, 30);

    expect(calls.filter((c) => c.method === "limit")).toHaveLength(0);
  });

  it("uses the cutoff `today + daysAhead` for expiration_date <=", async () => {
    const { client, calls } = createMockSupabase({ data: [], error: null });
    await inventoryService.getExpiringLots(client, 90);

    const lteCall = calls.find((c) => c.method === "lte");
    expect(lteCall?.args[0]).toBe("expiration_date");
    // System time pinned to 2026-05-13 → cutoff is 2026-08-11.
    expect(lteCall?.args[1]).toBe("2026-08-11");
  });

  it("maps view rows into ExpiringLot with correct field shapes", async () => {
    const { client } = createMockSupabase({
      data: [
        {
          id: "lot-1",
          lot_number: "LOT-001",
          remaining_quantity: 42,
          unit: "lb",
          expiration_date: "2026-05-20",
          location: "Cooler A",
          item: { name: "Cascade Hops" },
        },
      ],
      error: null,
    });

    const result = await inventoryService.getExpiringLots(client, 90);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        id: "lot-1",
        item_name: "Cascade Hops",
        lot_number: "LOT-001",
        remaining_quantity: 42,
        unit: "lb",
        expiration_date: "2026-05-20",
        location_name: "Cooler A",
      });
      expect(result.data[0].days_until_expiry).toBe(7);
    }
  });

  it("returns an err ServiceResult when Supabase errors", async () => {
    const { client } = createMockSupabase({
      data: null,
      error: { code: "42P01", message: "relation does not exist" },
    });

    const result = await inventoryService.getExpiringLots(client, 30);
    expect(result.success).toBe(false);
  });

  it("falls back to 'Unknown' when item join returns null", async () => {
    const { client } = createMockSupabase({
      data: [
        {
          id: "lot-2",
          lot_number: "LOT-002",
          remaining_quantity: 10,
          unit: "oz",
          expiration_date: "2026-05-20",
          location: null,
          item: null,
        },
      ],
      error: null,
    });

    const result = await inventoryService.getExpiringLots(client, 90);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0].item_name).toBe("Unknown");
    }
  });

  it("returns an empty list (not a crash) when the view returns a null payload", async () => {
    // PostgREST can hand back data:null with no error; the `?? []` guard is
    // what keeps the .map() from throwing.
    const { client } = createMockSupabase({ data: null, error: null });

    const result = await inventoryService.getExpiringLots(client, 30);

    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual([]);
  });

  it("converts a thrown Error into an UNKNOWN ServiceError instead of propagating", async () => {
    const { client } = createRejectingSupabase(new Error("connection reset"));

    const result = await inventoryService.getExpiringLots(client, 30);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("UNKNOWN");
      expect(result.error).toHaveProperty("message", "Failed to get expiring lots: connection reset");
    }
  });

  it("stringifies a non-Error rejection rather than rendering [object Object]/undefined", async () => {
    const { client } = createRejectingSupabase("socket hang up");

    const result = await inventoryService.getExpiringLots(client, 30);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toHaveProperty("message", "Failed to get expiring lots: socket hang up");
    }
  });
});
