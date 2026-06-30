/**
 * Tests for the order items editor's blur-commit parse/validation helper
 * (order-item-edit-utils.ts). Existing-row qty/price inputs buffer keystrokes
 * and only commit on blur/Enter; parseItemFieldEdit must reject
 * empty/NaN/out-of-range input (returning null so the editor reverts) instead
 * of coercing — the old onChange path coerced a cleared qty to 1 and a "0"
 * price to null mid-edit.
 */
import { describe, it, expect } from "vitest";
import { parseItemFieldEdit } from "@/components/domain/order/order-item-edit-utils";

describe("parseItemFieldEdit — quantity", () => {
  it("parses a valid integer quantity", () => {
    expect(parseItemFieldEdit("quantity", "24")).toBe(24);
    expect(parseItemFieldEdit("quantity", "1")).toBe(1);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseItemFieldEdit("quantity", " 12 ")).toBe(12);
  });

  it("rejects empty input instead of coercing to 1 (the old snap-to-1 bug)", () => {
    expect(parseItemFieldEdit("quantity", "")).toBeNull();
    expect(parseItemFieldEdit("quantity", "   ")).toBeNull();
  });

  it("rejects zero and negative quantities", () => {
    expect(parseItemFieldEdit("quantity", "0")).toBeNull();
    expect(parseItemFieldEdit("quantity", "-3")).toBeNull();
  });

  it("rejects non-integer quantities rather than truncating", () => {
    expect(parseItemFieldEdit("quantity", "2.5")).toBeNull();
  });

  it("rejects non-numeric input", () => {
    expect(parseItemFieldEdit("quantity", "abc")).toBeNull();
    expect(parseItemFieldEdit("quantity", "12abc")).toBeNull();
  });
});

describe("parseItemFieldEdit — unit_price", () => {
  it("parses valid decimal prices", () => {
    expect(parseItemFieldEdit("unit_price", "12.50")).toBe(12.5);
    expect(parseItemFieldEdit("unit_price", ".5")).toBe(0.5);
  });

  it("accepts zero as a legitimate price (old path coerced 0 to null)", () => {
    expect(parseItemFieldEdit("unit_price", "0")).toBe(0);
    expect(parseItemFieldEdit("unit_price", "0.00")).toBe(0);
  });

  it("rejects empty input instead of coercing to null", () => {
    expect(parseItemFieldEdit("unit_price", "")).toBeNull();
    expect(parseItemFieldEdit("unit_price", "  ")).toBeNull();
  });

  it("rejects negative prices", () => {
    expect(parseItemFieldEdit("unit_price", "-1")).toBeNull();
  });

  it("rejects non-numeric input", () => {
    expect(parseItemFieldEdit("unit_price", "abc")).toBeNull();
    expect(parseItemFieldEdit("unit_price", "1,50")).toBeNull();
  });
});
