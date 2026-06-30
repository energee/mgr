/**
 * Tests for the shared inventory unit list and alias-tolerant
 * normalization/equivalence helpers (src/domain/inventory-units.ts).
 */

import { describe, it, expect } from "vitest";
import {
  INVENTORY_UNIT_OPTIONS,
  normalizeInventoryUnit,
  unitsEquivalent,
  WHOLE_UNIT_VALUES,
  isWholeUnit,
} from "@/domain/inventory-units";

describe("INVENTORY_UNIT_OPTIONS", () => {
  it("has unique values", () => {
    const values = INVENTORY_UNIT_OPTIONS.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("is a superset of both legacy entity lists (lot list lacked 'case')", () => {
    const values = new Set(INVENTORY_UNIT_OPTIONS.map((o) => o.value));
    // Legacy inventory-item list (7 options) and inventory-lot list
    // (6 options, missing "case") must both be representable.
    for (const unit of ["lb", "oz", "kg", "g", "each", "case", "gal"]) {
      expect(values.has(unit), `missing unit '${unit}'`).toBe(true);
    }
  });

  it("contains every whole-unit code so countable items stay selectable", () => {
    const values = new Set(INVENTORY_UNIT_OPTIONS.map((o) => o.value));
    for (const unit of WHOLE_UNIT_VALUES) {
      expect(values.has(unit), `whole unit '${unit}' not in options`).toBe(
        true,
      );
    }
  });

  it("every option value is already canonical (normalizes to itself)", () => {
    for (const { value } of INVENTORY_UNIT_OPTIONS) {
      expect(normalizeInventoryUnit(value)).toBe(value);
    }
  });
});

describe("normalizeInventoryUnit", () => {
  it("collapses common aliases to canonical codes", () => {
    expect(normalizeInventoryUnit("lbs")).toBe("lb");
    expect(normalizeInventoryUnit("Pounds")).toBe("lb");
    expect(normalizeInventoryUnit("ounces")).toBe("oz");
    expect(normalizeInventoryUnit("ea")).toBe("each");
    expect(normalizeInventoryUnit("cases")).toBe("case");
    expect(normalizeInventoryUnit("Gallons")).toBe("gal");
    expect(normalizeInventoryUnit("grams")).toBe("g");
    expect(normalizeInventoryUnit("kilograms")).toBe("kg");
  });

  it("trims and lowercases", () => {
    expect(normalizeInventoryUnit("  LB  ")).toBe("lb");
    expect(normalizeInventoryUnit(" Each ")).toBe("each");
  });

  it("passes unrecognized units through lowercased", () => {
    expect(normalizeInventoryUnit("Sack")).toBe("sack");
    expect(normalizeInventoryUnit("55lb bag")).toBe("55lb bag");
  });

  it("returns empty string for null/undefined/blank", () => {
    expect(normalizeInventoryUnit(null)).toBe("");
    expect(normalizeInventoryUnit(undefined)).toBe("");
    expect(normalizeInventoryUnit("   ")).toBe("");
  });
});

describe("unitsEquivalent", () => {
  it("matches identical and alias units", () => {
    expect(unitsEquivalent("lb", "lb")).toBe(true);
    expect(unitsEquivalent("lb", "Lbs")).toBe(true);
    expect(unitsEquivalent("each", "ea")).toBe(true);
    expect(unitsEquivalent("case", "Cases")).toBe(true);
  });

  it("matches unknown units against themselves (legacy free text)", () => {
    expect(unitsEquivalent("sack", "Sack")).toBe(true);
  });

  it("rejects different units", () => {
    expect(unitsEquivalent("lb", "kg")).toBe(false);
    expect(unitsEquivalent("sack", "lb")).toBe(false);
    expect(unitsEquivalent("each", "case")).toBe(false);
  });

  it("rejects when either side is missing", () => {
    expect(unitsEquivalent("", "lb")).toBe(false);
    expect(unitsEquivalent("lb", null)).toBe(false);
    expect(unitsEquivalent(undefined, undefined)).toBe(false);
  });
});

describe("isWholeUnit (regression)", () => {
  it("still classifies each/case as whole units", () => {
    expect(isWholeUnit("each")).toBe(true);
    expect(isWholeUnit("case")).toBe(true);
    expect(isWholeUnit("lb")).toBe(false);
    expect(isWholeUnit(null)).toBe(false);
  });
});
