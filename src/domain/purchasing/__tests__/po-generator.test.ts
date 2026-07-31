// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
const singleMock = vi.fn();
const selectAfterInsertMock = vi.fn(() => ({ single: singleMock }));
const insertPOMock = vi.fn(() => ({ select: selectAfterInsertMock }));
const deleteEqMock = vi.fn();
const deleteMock = vi.fn(() => ({ eq: deleteEqMock }));
const insertLineItemsMock = vi.fn();
const fromMock = vi.fn((table: string) => {
  if (table === "purchase_orders") return { insert: insertPOMock, delete: deleteMock };
  if (table === "po_line_items") return { insert: insertLineItemsMock };
  throw new Error(`unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: rpcMock, from: fromMock }),
}));

import { groupShortfallsBySupplier, createDraftPO, type PODraft } from "../po-generator";
import { makeShortfall } from "./fixtures";

describe("groupShortfallsBySupplier", () => {
  it("groups shortfalls by supplier", () => {
    const shortfalls = [
      makeShortfall(),
      makeShortfall({ catalog_id: "id-2", catalog_name: "Crystal 60", lead_time_days: 10 }),
    ];
    const result = groupShortfallsBySupplier(shortfalls);
    expect(result).toHaveLength(1);
    expect(result[0].supplier_id).toBe("supplier-1");
    expect(result[0].line_items).toHaveLength(2);
  });

  it("uses earliest order_by_date", () => {
    const shortfalls = [
      makeShortfall({ order_by_date: "2026-03-20" }),
      makeShortfall({ catalog_id: "id-2", order_by_date: "2026-03-10" }),
    ];
    const result = groupShortfallsBySupplier(shortfalls);
    expect(result[0].order_by_date).toBe("2026-03-10");
  });

  it("computes max_lead_time_days from line items", () => {
    const shortfalls = [
      makeShortfall({ lead_time_days: 14 }),
      makeShortfall({ catalog_id: "id-2", lead_time_days: 21 }),
    ];
    const result = groupShortfallsBySupplier(shortfalls);
    expect(result[0].max_lead_time_days).toBe(21);
  });

  it("uses minimum of 7 for max_lead_time_days", () => {
    const shortfalls = [makeShortfall({ lead_time_days: 3 })];
    const result = groupShortfallsBySupplier(shortfalls);
    expect(result[0].max_lead_time_days).toBe(7);
  });

  it("passes lead_time_days through to line items", () => {
    const shortfalls = [makeShortfall({ lead_time_days: 14 })];
    const result = groupShortfallsBySupplier(shortfalls);
    expect(result[0].line_items[0].lead_time_days).toBe(14);
  });

  it("skips shortfalls without preferred supplier", () => {
    const shortfalls = [makeShortfall({ preferred_supplier_id: null })];
    const result = groupShortfallsBySupplier(shortfalls);
    expect(result).toHaveLength(0);
  });
});

describe("createDraftPO", () => {
  const draft: PODraft = {
    supplier_id: "supplier-1",
    supplier_name: "Supplier One",
    order_by_date: "2026-03-02",
    line_items: [],
    estimated_total: 0,
    item_count: 0,
    max_lead_time_days: 7,
  };

  beforeEach(() => {
    rpcMock.mockReset();
    singleMock.mockReset();
    insertPOMock.mockClear();
    insertLineItemsMock.mockReset();
    fromMock.mockClear();
    rpcMock.mockResolvedValueOnce({ data: "PO-2026-001", error: null });
    singleMock.mockResolvedValueOnce({ data: { id: "po-1" }, error: null });
    insertLineItemsMock.mockResolvedValueOnce({ error: null });
  });

  it("computes expected_date as calendar days after order_by_date across a DST transition", async () => {
    // 2026-03-02 + 7 calendar days = 2026-03-09, regardless of the US DST
    // "spring forward" transition (2026-03-08) that falls inside that span.
    // Tests run pinned to America/New_York (vitest.config.ts), where mixing
    // a UTC date parse with local getDate()/setDate() shifts this by a day.
    await createDraftPO(draft);
    expect(insertPOMock).toHaveBeenCalledWith(
      expect.objectContaining({
        order_date: "2026-03-02",
        expected_date: "2026-03-09",
      })
    );
  });
});
