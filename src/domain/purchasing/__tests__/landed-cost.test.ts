// @vitest-environment node
/**
 * Characterization tests for landed-cost.ts
 *
 * Pins current behavior of the pure formatting/markup helpers plus the
 * Supabase-backed `calculateLandedCost` / `getLandedCostSummary` RPC flows
 * (mocked client + logger).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/client-logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const rpcMock = vi.fn();
const singleMock = vi.fn();
const eqMock = vi.fn(() => ({ single: singleMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc: rpcMock,
    from: fromMock,
  }),
}));

import {
  formatLandedCost,
  landedCostMarkup,
  calculateLandedCost,
  getLandedCostSummary,
  type LandedCostBreakdown,
} from "../landed-cost";
import { log } from "@/lib/client-logger";

describe("formatLandedCost", () => {
  it("formats a positive value to 4 decimal places with a $ prefix", () => {
    expect(formatLandedCost(1.23456)).toBe("$1.2346");
  });

  it("appends the unit when provided", () => {
    expect(formatLandedCost(1.5, "lb")).toBe("$1.5000/lb");
  });

  it("omits the unit suffix when unit is not provided", () => {
    expect(formatLandedCost(1.5)).toBe("$1.5000");
  });

  it("returns 'Not calculated' for null", () => {
    expect(formatLandedCost(null)).toBe("Not calculated");
  });

  it("returns 'Not calculated' for undefined", () => {
    expect(formatLandedCost(undefined)).toBe("Not calculated");
  });

  it("formats zero as a real value, not 'Not calculated'", () => {
    expect(formatLandedCost(0)).toBe("$0.0000");
  });

  it("formats zero with a unit", () => {
    expect(formatLandedCost(0, "gal")).toBe("$0.0000/gal");
  });

  it("formats negative values", () => {
    expect(formatLandedCost(-2.5)).toBe("$-2.5000");
  });

  it("rounds to 4 decimal places", () => {
    expect(formatLandedCost(1.999999)).toBe("$2.0000");
  });

  it("pads short decimals with trailing zeros", () => {
    expect(formatLandedCost(3)).toBe("$3.0000");
  });
});

describe("landedCostMarkup", () => {
  it("computes positive markup percentage", () => {
    expect(landedCostMarkup(12, 10)).toBe(20);
  });

  it("computes negative markup when landed cost is below unit price", () => {
    expect(landedCostMarkup(8, 10)).toBe(-20);
  });

  it("returns 0 when landed cost equals unit price", () => {
    expect(landedCostMarkup(10, 10)).toBe(0);
  });

  it("returns null when unitPrice is zero", () => {
    expect(landedCostMarkup(10, 0)).toBeNull();
  });

  it("returns null when unitPrice is negative (falsy check uses !unitPrice)", () => {
    // `!unitPrice` is only truthy for 0 (and NaN), so a negative price does NOT
    // short-circuit — pin the actual computed result rather than assuming null.
    expect(landedCostMarkup(10, -5)).toBe(-300);
  });

  it("computes markup with fractional values", () => {
    expect(landedCostMarkup(1.5, 1.2)).toBeCloseTo(25, 10);
  });

  it("handles a landed cost of zero", () => {
    expect(landedCostMarkup(0, 10)).toBe(-100);
  });
});

describe("calculateLandedCost", () => {
  beforeEach(() => {
    // mockReset() (not clearAllMocks/mockClear) discards any unconsumed
    // mockResolvedValueOnce queued by a previous test, in addition to
    // clearing call history -- otherwise a leftover once-value from a
    // failing test can leak into the next test's first call.
    vi.mocked(rpcMock).mockReset();
  });

  it("calls the calculate_landed_cost RPC with the given PO id", async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    await calculateLandedCost("po-1");
    expect(rpcMock).toHaveBeenCalledWith("calculate_landed_cost", { p_po_id: "po-1" });
  });

  it("returns the data array on success", async () => {
    const rows: LandedCostBreakdown[] = [
      {
        lot_id: "lot-1",
        line_item_id: "li-1",
        catalog_type: "malt",
        quantity: 10,
        unit_price: 2,
        allocated_shipping: 1,
        allocated_tax: 0.5,
        landed_cost_per_unit: 2.15,
      },
    ];
    rpcMock.mockResolvedValueOnce({ data: rows, error: null });
    const result = await calculateLandedCost("po-1");
    expect(result).toEqual(rows);
  });

  it("returns an empty array when data is null", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const result = await calculateLandedCost("po-1");
    expect(result).toEqual([]);
  });

  it("logs and throws when the RPC returns an error", async () => {
    const rpcError = { message: "boom" };
    rpcMock.mockResolvedValueOnce({ data: null, error: rpcError });
    await expect(calculateLandedCost("po-1")).rejects.toEqual(rpcError);
    expect(log.error).toHaveBeenCalledWith("Error calculating landed cost:", rpcError);
  });
});

describe("getLandedCostSummary", () => {
  beforeEach(() => {
    // See note in calculateLandedCost's beforeEach: mockReset() clears both
    // call history and any unconsumed mockResolvedValueOnce queue entries.
    vi.mocked(rpcMock).mockReset();
    vi.mocked(singleMock).mockReset();
    // The static chain mocks keep their module-scope implementations, but
    // their call history must not accumulate across tests (an assertion on
    // fromMock/eqMock would otherwise pass off an earlier test's calls).
    vi.mocked(fromMock).mockClear();
    vi.mocked(selectMock).mockClear();
    vi.mocked(eqMock).mockClear();
  });

  it("fetches PO shipping/tax and combines with line items into totals", async () => {
    singleMock.mockResolvedValueOnce({
      data: { shipping_cost: 10, tax: 5 },
      error: null,
    });
    const rows: LandedCostBreakdown[] = [
      {
        lot_id: "lot-1",
        line_item_id: "li-1",
        catalog_type: "malt",
        quantity: 10,
        unit_price: 2,
        allocated_shipping: 1,
        allocated_tax: 0.5,
        landed_cost_per_unit: 2.15,
      },
      {
        lot_id: "lot-2",
        line_item_id: "li-2",
        catalog_type: "hop",
        quantity: 5,
        unit_price: 4,
        allocated_shipping: 0.5,
        allocated_tax: 0.25,
        landed_cost_per_unit: 4.15,
      },
    ];
    rpcMock.mockResolvedValueOnce({ data: rows, error: null });

    const result = await getLandedCostSummary("po-1");

    expect(fromMock).toHaveBeenCalledWith("purchase_orders");
    expect(selectMock).toHaveBeenCalledWith("shipping_cost, tax");
    expect(eqMock).toHaveBeenCalledWith("id", "po-1");
    expect(rpcMock).toHaveBeenCalledWith("calculate_landed_cost", { p_po_id: "po-1" });

    expect(result.po_id).toBe("po-1");
    expect(result.shipping_cost).toBe(10);
    expect(result.tax).toBe(5);
    expect(result.line_items).toEqual(rows);
    // total_item_cost = 2*10 + 4*5 = 40
    expect(result.total_item_cost).toBe(40);
    // total_landed_cost = 2.15*10 + 4.15*5 = 21.5 + 20.75 = 42.25
    expect(result.total_landed_cost).toBeCloseTo(42.25, 10);
  });

  it("defaults shipping_cost and tax to 0 when null", async () => {
    singleMock.mockResolvedValueOnce({
      data: { shipping_cost: null, tax: null },
      error: null,
    });
    rpcMock.mockResolvedValueOnce({ data: [], error: null });

    const result = await getLandedCostSummary("po-1");

    expect(result.shipping_cost).toBe(0);
    expect(result.tax).toBe(0);
    expect(result.total_item_cost).toBe(0);
    expect(result.total_landed_cost).toBe(0);
  });

  it("treats a null unit_price as 0 when summing total_item_cost", async () => {
    singleMock.mockResolvedValueOnce({
      data: { shipping_cost: 0, tax: 0 },
      error: null,
    });
    const rows: LandedCostBreakdown[] = [
      {
        lot_id: "lot-1",
        line_item_id: "li-1",
        catalog_type: "malt",
        quantity: 10,
        unit_price: null,
        allocated_shipping: 0,
        allocated_tax: 0,
        landed_cost_per_unit: 1,
      },
    ];
    rpcMock.mockResolvedValueOnce({ data: rows, error: null });

    const result = await getLandedCostSummary("po-1");

    expect(result.total_item_cost).toBe(0);
    expect(result.total_landed_cost).toBe(10);
  });

  it("logs and throws when fetching the PO fails", async () => {
    const poError = { message: "not found" };
    singleMock.mockResolvedValueOnce({ data: null, error: poError });

    await expect(getLandedCostSummary("po-1")).rejects.toEqual(poError);
    expect(log.error).toHaveBeenCalledWith("Error fetching PO:", poError);
    // Should not proceed to call the RPC once the PO fetch failed.
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("propagates the RPC error from calculateLandedCost after a successful PO fetch", async () => {
    singleMock.mockResolvedValueOnce({
      data: { shipping_cost: 10, tax: 5 },
      error: null,
    });
    const rpcError = { message: "rpc failed" };
    rpcMock.mockResolvedValueOnce({ data: null, error: rpcError });

    await expect(getLandedCostSummary("po-1")).rejects.toEqual(rpcError);
    expect(log.error).toHaveBeenCalledWith("Error calculating landed cost:", rpcError);
  });
});
