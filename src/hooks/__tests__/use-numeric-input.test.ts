/**
 * Unit tests for parseEditableNumber — the commit-parsing half of
 * useNumericInput. Behavioral coverage of the hook itself lives in
 * src/components/ui/__tests__/unit-input.test.tsx and
 * src/components/universal/__tests__/field-input-number.test.tsx.
 */

import { describe, it, expect } from "vitest";
import { parseEditableNumber } from "@/hooks/use-numeric-input";

describe("parseEditableNumber", () => {
  it("parses complete numbers", () => {
    expect(parseEditableNumber("5")).toBe(5);
    expect(parseEditableNumber("-5")).toBe(-5);
    expect(parseEditableNumber("0")).toBe(0);
    expect(parseEditableNumber("7.753")).toBe(7.753);
    expect(parseEditableNumber("-.5")).toBe(-0.5);
    expect(parseEditableNumber(".5")).toBe(0.5);
    expect(parseEditableNumber("1e3")).toBe(1000);
    expect(parseEditableNumber(" 2.5 ")).toBe(2.5);
  });

  it("returns null (never NaN) for empty and in-progress strings", () => {
    expect(parseEditableNumber("")).toBeNull();
    expect(parseEditableNumber("   ")).toBeNull();
    expect(parseEditableNumber("-")).toBeNull();
    expect(parseEditableNumber(".")).toBeNull();
    expect(parseEditableNumber("-.")).toBeNull();
    expect(parseEditableNumber("1e")).toBeNull();
  });

  it("parses trailing-separator numbers to their numeric value", () => {
    expect(parseEditableNumber("1.")).toBe(1);
    expect(parseEditableNumber("1.0")).toBe(1);
  });

  it("rejects invalid text rather than truncating it", () => {
    expect(parseEditableNumber("5x")).toBeNull();
    expect(parseEditableNumber("abc")).toBeNull();
    expect(parseEditableNumber("1,5")).toBeNull();
    expect(parseEditableNumber("Infinity")).toBeNull();
  });
});
