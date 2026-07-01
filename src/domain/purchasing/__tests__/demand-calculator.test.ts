/**
 * Characterization tests for demand-calculator.ts. Pins current behavior of
 * the pure display/formatting helpers and the Supabase-backed demand/shortfall
 * aggregation functions (via mocked `dynamicRpc`).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/client-logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/services/types", () => ({ dynamicRpc: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

import { dynamicRpc } from "@/services/types";
import { log } from "@/lib/client-logger";
import {
  getCatalogTypeDisplay,
  formatQuantityWithUnit,
  calculateIngredientDemand,
  calculateIngredientShortfalls,
  getDemandSummary,
  type IngredientDemand,
  type IngredientShortfall,
} from "../demand-calculator";

describe("getCatalogTypeDisplay", () => {
  it("maps malt to Malt", () => {
    expect(getCatalogTypeDisplay("malt")).toBe("Malt");
  });

  it("maps hop to Hop", () => {
    expect(getCatalogTypeDisplay("hop")).toBe("Hop");
  });

  it("maps yeast to Yeast", () => {
    expect(getCatalogTypeDisplay("yeast")).toBe("Yeast");
  });

  it("maps adjunct to Adjunct", () => {
    expect(getCatalogTypeDisplay("adjunct")).toBe("Adjunct");
  });

  it("maps sugar to Sugar", () => {
    expect(getCatalogTypeDisplay("sugar")).toBe("Sugar");
  });

  it("maps spice to Spice", () => {
    expect(getCatalogTypeDisplay("spice")).toBe("Spice");
  });

  it("maps fruit to Fruit", () => {
    expect(getCatalogTypeDisplay("fruit")).toBe("Fruit");
  });

  it("falls back to the raw catalog_type for unknown values", () => {
    expect(getCatalogTypeDisplay("mystery")).toBe("mystery");
  });

  it("falls back to an empty string unchanged", () => {
    expect(getCatalogTypeDisplay("")).toBe("");
  });

  it("is case-sensitive (does not normalize casing)", () => {
    expect(getCatalogTypeDisplay("Malt")).toBe("Malt");
  });
});

describe("formatQuantityWithUnit", () => {
  it("formats a whole number with a unit suffix", () => {
    expect(formatQuantityWithUnit(100, "lb")).toBe("100 lb");
  });

  it("formats zero", () => {
    expect(formatQuantityWithUnit(0, "oz")).toBe("0 oz");
  });

  it("rounds to a maximum of 2 fraction digits", () => {
    expect(formatQuantityWithUnit(1.23456, "kg")).toBe("1.23 kg");
  });

  it("does not force trailing fraction digits for whole numbers", () => {
    expect(formatQuantityWithUnit(5, "gal")).toBe("5 gal");
  });

  it("preserves a single fraction digit without padding to two", () => {
    expect(formatQuantityWithUnit(2.5, "lb")).toBe("2.5 lb");
  });

  it("formats negative numbers", () => {
    expect(formatQuantityWithUnit(-3.5, "lb")).toBe("-3.5 lb");
  });

  it("inserts thousands separators for large numbers", () => {
    expect(formatQuantityWithUnit(12345, "lb")).toBe("12,345 lb");
  });

  it("handles an empty unit string", () => {
    expect(formatQuantityWithUnit(10, "")).toBe("10 ");
  });

  it("rounds a value with more than 2 fraction digits to 2", () => {
    // 1.005 is not exactly representable in binary floating point (it's
    // slightly above 1.005), so toLocaleString rounds up to 1.01 rather than
    // down to 1 — pinning the actual JS float behavior, not idealized rounding.
    expect(formatQuantityWithUnit(1.005, "lb")).toBe("1.01 lb");
  });
});

describe("calculateIngredientDemand", () => {
  beforeEach(() => {
    vi.mocked(dynamicRpc).mockReset();
  });

  const makeDemand = (overrides: Partial<IngredientDemand> = {}): IngredientDemand => ({
    catalog_type: "malt",
    catalog_id: "id-1",
    catalog_name: "Pale Malt",
    total_required: 100,
    unit: "lb",
    earliest_required_by: "2026-04-01",
    batch_count: 2,
    ...overrides,
  });

  it("returns the RPC data cast to IngredientDemand[]", async () => {
    const rows = [makeDemand()];
    vi.mocked(dynamicRpc).mockResolvedValue({ data: rows, error: null });

    const result = await calculateIngredientDemand();

    expect(result).toEqual(rows);
  });

  it("calls dynamicRpc with default params", async () => {
    vi.mocked(dynamicRpc).mockResolvedValue({ data: [], error: null });

    await calculateIngredientDemand();

    expect(dynamicRpc).toHaveBeenCalledWith(
      expect.anything(),
      "calculate_ingredient_demand",
      { p_horizon_weeks: 8, p_include_planned: true, p_include_fermenting: true }
    );
  });

  it("passes through custom horizonWeeks/includePlanned/includeFermenting", async () => {
    vi.mocked(dynamicRpc).mockResolvedValue({ data: [], error: null });

    await calculateIngredientDemand(4, false, true);

    expect(dynamicRpc).toHaveBeenCalledWith(
      expect.anything(),
      "calculate_ingredient_demand",
      { p_horizon_weeks: 4, p_include_planned: false, p_include_fermenting: true }
    );
  });

  it("returns an empty array when data is null", async () => {
    vi.mocked(dynamicRpc).mockResolvedValue({ data: null, error: null });

    const result = await calculateIngredientDemand();

    expect(result).toEqual([]);
  });

  it("logs and throws when the RPC returns an error", async () => {
    const rpcError = new Error("rpc failed");
    vi.mocked(dynamicRpc).mockResolvedValue({ data: null, error: rpcError });

    await expect(calculateIngredientDemand()).rejects.toThrow("rpc failed");
    expect(log.error).toHaveBeenCalledWith("Error calculating ingredient demand:", rpcError);
  });
});

describe("calculateIngredientShortfalls", () => {
  beforeEach(() => {
    vi.mocked(dynamicRpc).mockReset();
  });

  const makeShortfall = (overrides: Partial<IngredientShortfall> = {}): IngredientShortfall => ({
    catalog_type: "malt",
    catalog_id: "id-1",
    catalog_name: "Pale Malt",
    total_required: 100,
    available_qty: 50,
    on_order_qty: 0,
    shortfall_qty: 50,
    unit: "lb",
    required_by_date: "2026-04-01",
    order_by_date: "2026-03-15",
    lead_time_days: 14,
    preferred_supplier_id: "supplier-1",
    preferred_supplier_name: "Supplier A",
    min_order_qty: null,
    unit_price: 1.5,
    is_urgent: false,
    batch_count: 1,
    ...overrides,
  });

  it("returns the RPC data cast to IngredientShortfall[]", async () => {
    const rows = [makeShortfall()];
    vi.mocked(dynamicRpc).mockResolvedValue({ data: rows, error: null });

    const result = await calculateIngredientShortfalls();

    expect(result).toEqual(rows);
  });

  it("calls dynamicRpc with default horizonWeeks", async () => {
    vi.mocked(dynamicRpc).mockResolvedValue({ data: [], error: null });

    await calculateIngredientShortfalls();

    expect(dynamicRpc).toHaveBeenCalledWith(
      expect.anything(),
      "calculate_ingredient_shortfalls",
      { p_horizon_weeks: 8 }
    );
  });

  it("passes through a custom horizonWeeks", async () => {
    vi.mocked(dynamicRpc).mockResolvedValue({ data: [], error: null });

    await calculateIngredientShortfalls(2);

    expect(dynamicRpc).toHaveBeenCalledWith(
      expect.anything(),
      "calculate_ingredient_shortfalls",
      { p_horizon_weeks: 2 }
    );
  });

  it("returns an empty array when data is null", async () => {
    vi.mocked(dynamicRpc).mockResolvedValue({ data: null, error: null });

    const result = await calculateIngredientShortfalls();

    expect(result).toEqual([]);
  });

  it("logs and throws when the RPC returns an error", async () => {
    const rpcError = new Error("shortfall rpc failed");
    vi.mocked(dynamicRpc).mockResolvedValue({ data: null, error: rpcError });

    await expect(calculateIngredientShortfalls()).rejects.toThrow("shortfall rpc failed");
    expect(log.error).toHaveBeenCalledWith("Error calculating ingredient shortfalls:", rpcError);
  });
});

describe("getDemandSummary", () => {
  const makeDemand = (overrides: Partial<IngredientDemand> = {}): IngredientDemand => ({
    catalog_type: "malt",
    catalog_id: "id-1",
    catalog_name: "Pale Malt",
    total_required: 100,
    unit: "lb",
    earliest_required_by: "2026-04-01",
    batch_count: 2,
    ...overrides,
  });

  const makeShortfall = (overrides: Partial<IngredientShortfall> = {}): IngredientShortfall => ({
    catalog_type: "malt",
    catalog_id: "id-1",
    catalog_name: "Pale Malt",
    total_required: 100,
    available_qty: 50,
    on_order_qty: 0,
    shortfall_qty: 50,
    unit: "lb",
    required_by_date: "2026-04-01",
    order_by_date: "2026-03-15",
    lead_time_days: 14,
    preferred_supplier_id: "supplier-1",
    preferred_supplier_name: "Supplier A",
    min_order_qty: null,
    unit_price: 1.5,
    is_urgent: false,
    batch_count: 1,
    ...overrides,
  });

  beforeEach(() => {
    vi.mocked(dynamicRpc).mockReset();
  });

  it("aggregates totals, shortfall/urgent counts, and ingredient count", async () => {
    // getDemandSummary calls calculateIngredientShortfalls first, then
    // calculateIngredientDemand — mockResolvedValueOnce ordering below relies
    // on that call order (both RPCs go through the same mocked dynamicRpc).
    vi.mocked(dynamicRpc)
      .mockResolvedValueOnce({
        data: [
          makeShortfall({ shortfall_qty: 30, is_urgent: true }),
          makeShortfall({ catalog_id: "id-2", shortfall_qty: 20, is_urgent: false }),
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          makeDemand({ total_required: 100 }),
          makeDemand({ catalog_id: "id-2", total_required: 50 }),
        ],
        error: null,
      });

    const summary = await getDemandSummary();

    expect(summary).toEqual({
      totalDemand: 150,
      coveredByInventory: 100, // 150 - (30 + 20)
      shortfallCount: 2,
      urgentCount: 1,
      totalIngredients: 2,
    });
  });

  it("returns all-zero summary when both RPCs return empty data", async () => {
    vi.mocked(dynamicRpc)
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null });

    const summary = await getDemandSummary();

    expect(summary).toEqual({
      totalDemand: 0,
      coveredByInventory: 0,
      shortfallCount: 0,
      urgentCount: 0,
      totalIngredients: 0,
    });
  });

  it("passes the horizonWeeks argument through to both underlying RPCs", async () => {
    vi.mocked(dynamicRpc)
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null });

    await getDemandSummary(3);

    expect(dynamicRpc).toHaveBeenCalledWith(
      expect.anything(),
      "calculate_ingredient_shortfalls",
      { p_horizon_weeks: 3 }
    );
    expect(dynamicRpc).toHaveBeenCalledWith(
      expect.anything(),
      "calculate_ingredient_demand",
      { p_horizon_weeks: 3, p_include_planned: true, p_include_fermenting: true }
    );
  });

  it("propagates an error from calculateIngredientShortfalls", async () => {
    const rpcError = new Error("shortfall failure");
    vi.mocked(dynamicRpc).mockResolvedValueOnce({ data: null, error: rpcError });

    await expect(getDemandSummary()).rejects.toThrow("shortfall failure");
  });
});
