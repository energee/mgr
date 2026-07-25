// @vitest-environment node
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
  type IngredientDemand,
} from "../demand-calculator";
import { makeShortfall } from "./fixtures";

/** Build an IngredientDemand with sensible defaults, overridable per-field. */
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

describe("getCatalogTypeDisplay", () => {
  it.each([
    ["malt", "Malt"],
    ["hop", "Hop"],
    ["yeast", "Yeast"],
    ["adjunct", "Adjunct"],
    ["sugar", "Sugar"],
    ["spice", "Spice"],
    ["fruit", "Fruit"],
  ])("maps %s to %s", (input, expected) => {
    expect(getCatalogTypeDisplay(input)).toBe(expected);
  });

  it("falls back to the raw catalog_type for unknown values", () => {
    expect(getCatalogTypeDisplay("mystery")).toBe("mystery");
  });

  it("falls back to an empty string unchanged", () => {
    expect(getCatalogTypeDisplay("")).toBe("");
  });

  it("is case-sensitive (does not normalize casing)", () => {
    // Case-sensitive fallback returns the input verbatim ("HOP"); a
    // hypothetical case-insensitive lookup would instead return "Hop".
    expect(getCatalogTypeDisplay("HOP")).toBe("HOP");
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
    // The IEEE-754 double for 1.005 is actually ~1.0049999999999998934 —
    // slightly BELOW 1.005, not above it. toLocaleString doesn't round that
    // exact binary value; it rounds the shortest decimal string that
    // represents it ("1.005") half-up to "1.01". That's why this differs
    // from exact-value rounding: (1.005).toFixed(2) === "1.00", because
    // toFixed operates on the true binary value rather than the shortest
    // decimal representation.
    expect(formatQuantityWithUnit(1.005, "lb")).toBe("1.01 lb");
  });
});

describe("calculateIngredientDemand", () => {
  beforeEach(() => {
    vi.mocked(dynamicRpc).mockReset();
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

