/**
 * Reorder / Duplicate Order tests
 *
 * Covers the S6 reorder flow (src/components/domain/order/reorder.ts):
 * - order-number suffix generation ({base}-R{n}, unique-aware)
 * - duplicateOrder: draft header shape, line-item copying with unit prices
 *   re-resolved via get_price_for_customer (fallback to the source price),
 *   retry on a unique-violation race, and header cleanup when the item copy
 *   fails
 * - entity wiring: the order "duplicate" action is a handler action (orders
 *   must NOT use the framework excludeOnDuplicate path — line items live in
 *   a post-create child table) and the customer Orders tab uses the custom
 *   relation component that surfaces "Reorder last"
 */

import { describe, it, expect, vi } from "vitest";

// Entity configs transitively import components that call createClient()
// at module scope — mock to avoid env var requirements during import.
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ data: [], error: null }),
    }),
  }),
}));

import {
  duplicateOrder,
  nextDuplicateOrderNumber,
  localDateString,
} from "../reorder";
import { orderEntity } from "@/entities/order";
import { customerEntity } from "@/entities/customer";

// =============================================================================
// Mock Supabase client scripted for the duplicateOrder call sequence
// =============================================================================

type Result<T> = { data: T; error: unknown };

type MockScript = {
  sourceOrder?: Result<unknown>;
  sourceItems?: Result<unknown[]>;
  taken?: Result<{ order_number: string }[]>;
  /** Consumed per header-insert attempt (for retry tests). */
  headerInserts?: Result<{ id: string } | null>[];
  itemsInsert?: { error: unknown };
  /** Price lookup keyed off args; default returns no rows (fallback path). */
  rpc?: (args: Record<string, unknown>) => Result<unknown[]>;
};

function createMockClient(script: MockScript) {
  const calls = {
    headerInsertPayloads: [] as Record<string, unknown>[],
    itemInsertPayloads: [] as Record<string, unknown>[][],
    deletedOrderIds: [] as string[],
    rpcArgs: [] as Record<string, unknown>[],
  };
  let headerAttempt = 0;

  const client = {
    from(table: string) {
      if (table === "orders") {
        return {
          select(cols: string) {
            if (cols === "order_number") {
              // taken-suffix LIKE query
              return {
                like: async () => script.taken ?? { data: [], error: null },
              };
            }
            // source header lookup
            return {
              eq: () => ({
                single: async () =>
                  script.sourceOrder ?? { data: null, error: { message: "not found" } },
              }),
            };
          },
          insert(payload: Record<string, unknown>) {
            calls.headerInsertPayloads.push(payload);
            const response =
              script.headerInserts?.[headerAttempt] ??
              ({ data: { id: "new-order-1" }, error: null } as Result<{ id: string }>);
            headerAttempt += 1;
            return { select: () => ({ single: async () => response }) };
          },
          delete() {
            return {
              eq: async (_col: string, id: string) => {
                calls.deletedOrderIds.push(id);
                return { error: null };
              },
            };
          },
        };
      }
      if (table === "order_items") {
        return {
          select: () => ({
            eq: () => ({
              order: async () => script.sourceItems ?? { data: [], error: null },
            }),
          }),
          insert: async (rows: Record<string, unknown>[]) => {
            calls.itemInsertPayloads.push(rows);
            return script.itemsInsert ?? { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      calls.rpcArgs.push(args);
      return script.rpc ? script.rpc(args) : { data: [], error: null };
    },
  };

  return {
    client: client as unknown as Parameters<typeof duplicateOrder>[0],
    calls,
  };
}

const SOURCE_ORDER = {
  data: { id: "src-1", order_number: "ORD-1", customer_id: "cust-1", notes: "ring bell" },
  error: null,
};

// =============================================================================
// nextDuplicateOrderNumber
// =============================================================================

describe("nextDuplicateOrderNumber", () => {
  it("appends -R1 for the first duplicate", () => {
    expect(nextDuplicateOrderNumber("ORD-2025-001", [])).toBe("ORD-2025-001-R1");
  });

  it("increments past the highest taken suffix", () => {
    expect(
      nextDuplicateOrderNumber("ORD-2025-001", [
        "ORD-2025-001-R1",
        "ORD-2025-001-R3",
      ])
    ).toBe("ORD-2025-001-R4");
  });

  it("strips an existing -R suffix so duplicating a duplicate keeps one suffix", () => {
    expect(
      nextDuplicateOrderNumber("ORD-2025-001-R2", ["ORD-2025-001-R2"])
    ).toBe("ORD-2025-001-R3");
  });

  it("ignores numbers that merely share the prefix", () => {
    expect(
      nextDuplicateOrderNumber("ORD-2025-001", ["ORD-2025-0010-R5", "ORD-2025-001X"])
    ).toBe("ORD-2025-001-R1");
  });
});

// =============================================================================
// localDateString
// =============================================================================

describe("localDateString", () => {
  it("formats a local calendar date as YYYY-MM-DD with zero padding", () => {
    expect(localDateString(new Date(2026, 2, 5, 10, 30))).toBe("2026-03-05");
  });
});

// =============================================================================
// duplicateOrder
// =============================================================================

describe("duplicateOrder", () => {
  it("inserts a draft header and copies items with prices re-resolved (fallback to source price)", async () => {
    const { client, calls } = createMockClient({
      sourceOrder: SOURCE_ORDER,
      sourceItems: {
        data: [
          {
            brand_id: "brand-1",
            selling_format_id: "fmt-1",
            keg_owner_id: null,
            style_id: null,
            quantity: 10,
            unit_price: 11,
          },
          {
            brand_id: "brand-2",
            selling_format_id: "fmt-2",
            keg_owner_id: "keg-owner-1",
            style_id: "style-1",
            quantity: 2,
            unit_price: 9,
          },
        ],
        error: null,
      },
      // fmt-1 re-resolves to a new tier price; fmt-2 has no tier price
      rpc: (args) =>
        args.p_format_id === "fmt-1"
          ? { data: [{ price: 12.5, tier_name: "Tier A" }], error: null }
          : { data: [], error: null },
    });

    const result = await duplicateOrder(client, "src-1");
    expect(result).toEqual({ id: "new-order-1", orderNumber: "ORD-1-R1" });

    // Header: draft, today, fresh number, customer/notes carried over
    expect(calls.headerInsertPayloads).toHaveLength(1);
    expect(calls.headerInsertPayloads[0]).toEqual({
      order_number: "ORD-1-R1",
      customer_id: "cust-1",
      status: "draft",
      order_date: localDateString(),
      notes: "ring bell",
    });

    // Items: copied with re-resolved price (fmt-1) and fallback price (fmt-2)
    expect(calls.itemInsertPayloads).toHaveLength(1);
    expect(calls.itemInsertPayloads[0]).toEqual([
      {
        order_id: "new-order-1",
        brand_id: "brand-1",
        selling_format_id: "fmt-1",
        keg_owner_id: null,
        style_id: null,
        quantity: 10,
        unit_price: 12.5,
      },
      {
        order_id: "new-order-1",
        brand_id: "brand-2",
        selling_format_id: "fmt-2",
        keg_owner_id: "keg-owner-1",
        style_id: "style-1",
        quantity: 2,
        unit_price: 9,
      },
    ]);

    // Price lookups went through get_price_for_customer with the customer
    expect(calls.rpcArgs).toHaveLength(2);
    expect(calls.rpcArgs[0]).toMatchObject({
      p_customer_id: "cust-1",
      p_format_id: "fmt-1",
    });
  });

  it("keeps the source price when the order has no customer (no RPC call)", async () => {
    const { client, calls } = createMockClient({
      sourceOrder: {
        data: { id: "src-1", order_number: "ORD-1", customer_id: null, notes: null },
        error: null,
      },
      sourceItems: {
        data: [
          {
            brand_id: "brand-1",
            selling_format_id: "fmt-1",
            keg_owner_id: null,
            style_id: null,
            quantity: 4,
            unit_price: 7,
          },
        ],
        error: null,
      },
    });

    await duplicateOrder(client, "src-1");
    expect(calls.rpcArgs).toHaveLength(0);
    expect(calls.itemInsertPayloads[0][0]).toMatchObject({ unit_price: 7 });
  });

  it("retries with the next suffix on a unique-violation race", async () => {
    const { client, calls } = createMockClient({
      sourceOrder: SOURCE_ORDER,
      headerInserts: [
        { data: null, error: { code: "23505", message: "duplicate key" } },
        { data: { id: "new-order-2" }, error: null },
      ],
    });

    const result = await duplicateOrder(client, "src-1");
    expect(result).toEqual({ id: "new-order-2", orderNumber: "ORD-1-R2" });
    expect(calls.headerInsertPayloads.map((p) => p.order_number)).toEqual([
      "ORD-1-R1",
      "ORD-1-R2",
    ]);
  });

  it("deletes the created header when copying items fails (no orphan empty draft)", async () => {
    const { client, calls } = createMockClient({
      sourceOrder: SOURCE_ORDER,
      sourceItems: {
        data: [
          {
            brand_id: null,
            selling_format_id: null,
            keg_owner_id: null,
            style_id: null,
            quantity: 1,
            unit_price: null,
          },
        ],
        error: null,
      },
      itemsInsert: { error: { message: "boom" } },
    });

    await expect(duplicateOrder(client, "src-1")).rejects.toBeTruthy();
    expect(calls.deletedOrderIds).toEqual(["new-order-1"]);
  });

  it("skips the item insert entirely for an order with no items", async () => {
    const { client, calls } = createMockClient({ sourceOrder: SOURCE_ORDER });
    const result = await duplicateOrder(client, "src-1");
    expect(result.id).toBe("new-order-1");
    expect(calls.itemInsertPayloads).toHaveLength(0);
  });
});

// =============================================================================
// Entity wiring
// =============================================================================

describe("reorder entity wiring", () => {
  it("order has a handler-based duplicate action (dropdown, confirmed, available from any state)", () => {
    const action = orderEntity.actions?.find((a) => a.name === "duplicate");
    expect(action).toBeDefined();
    expect(action!.type).toBe("dropdown");
    expect(action!.confirm).toBe(true);
    expect(action!.handler).toBeDefined();
    // Not a state transition, and no fromStates: reordering fulfilled or
    // cancelled orders is the point.
    expect(action!.toState).toBeUndefined();
    expect(action!.fromStates).toBeUndefined();
  });

  it("order does NOT use the framework excludeOnDuplicate path (line items would be dropped)", () => {
    expect(orderEntity.excludeOnDuplicate).toBeUndefined();
  });

  it("customer Orders tab uses the custom relation component with Reorder last", () => {
    const ordersRelation = customerEntity.relations?.find((r) => r.name === "orders");
    expect(ordersRelation).toBeDefined();
    expect(ordersRelation!.component).toBeDefined();
  });
});
