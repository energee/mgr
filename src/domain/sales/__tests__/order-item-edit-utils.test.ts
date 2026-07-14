/**
 * Tests for the shared line-item blur-commit parse/validation helpers
 * (order-item-edit-utils.ts). Existing-row qty/price inputs buffer keystrokes
 * and only commit on blur/Enter; parseItemFieldEdit must reject
 * empty/NaN/out-of-range input (returning null so the editor reverts) instead
 * of coercing — the old onChange path coerced a cleared qty to 1 and a "0"
 * price to null mid-edit. parsePoItemFieldEdit is the purchasing twin
 * (audit UI-6): identical price semantics, decimal quantities.
 */
import { describe, it, expect } from "vitest";
import {
  parseItemFieldEdit,
  parsePoItemFieldEdit,
} from "@/domain/sales/order-item-edit-utils";

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

describe("parsePoItemFieldEdit — quantity (decimal, positive)", () => {
  it("accepts decimal quantities (raw materials are ordered in e.g. 55.5 lb)", () => {
    expect(parsePoItemFieldEdit("quantity", "55.5")).toBe(55.5);
    expect(parsePoItemFieldEdit("quantity", "0.25")).toBe(0.25);
    expect(parsePoItemFieldEdit("quantity", "10")).toBe(10);
  });

  it("rejects zero, negative, empty and non-numeric quantities", () => {
    expect(parsePoItemFieldEdit("quantity", "0")).toBeNull();
    expect(parsePoItemFieldEdit("quantity", "-3")).toBeNull();
    expect(parsePoItemFieldEdit("quantity", "")).toBeNull();
    expect(parsePoItemFieldEdit("quantity", "  ")).toBeNull();
    expect(parsePoItemFieldEdit("quantity", "abc")).toBeNull();
    expect(parsePoItemFieldEdit("quantity", "12abc")).toBeNull();
  });
});

describe("parsePoItemFieldEdit — unit_price (reuses order-item semantics)", () => {
  it("preserves an explicit $0 (the PO add path stored $0 as NULL — audit UI-6)", () => {
    expect(parsePoItemFieldEdit("unit_price", "0")).toBe(0);
    expect(parsePoItemFieldEdit("unit_price", "0.00")).toBe(0);
  });

  it("matches parseItemFieldEdit for representative price inputs", () => {
    for (const raw of ["12.50", ".5", "0", "", "  ", "-1", "abc", "1,50"]) {
      expect(parsePoItemFieldEdit("unit_price", raw)).toBe(
        parseItemFieldEdit("unit_price", raw)
      );
    }
  });
});
