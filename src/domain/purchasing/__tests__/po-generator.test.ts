// @vitest-environment node
import { describe, it, expect } from "vitest";
import { groupShortfallsBySupplier } from "../po-generator";
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
