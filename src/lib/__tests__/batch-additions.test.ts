import { describe, it, expect } from "vitest";
import {
  formatAddition,
  ADDITION_TYPES,
  UNIT_OPTIONS,
  type BatchAddition,
} from "\@/domain/batch-additions";

describe("formatAddition", () => {
  it("formats dry hop with contact time", () => {
    const addition: BatchAddition = {
      addition_type: "dry_hop",
      ingredient_name: "Cascade",
      quantity: 2,
      unit: "oz",
      timestamp: "2024-01-15T10:00:00Z",
      contact_time_hours: 72,
    };
    expect(formatAddition(addition)).toBe("2 oz Cascade (Dry Hop, 72h contact)");
  });

  it("formats fruit without contact time", () => {
    const addition: BatchAddition = {
      addition_type: "fruit",
      ingredient_name: "Mango Puree",
      quantity: 5,
      unit: "lb",
      timestamp: "2024-01-15T10:00:00Z",
    };
    expect(formatAddition(addition)).toBe("5 lb Mango Puree (Fruit)");
  });

  it("formats fining agent", () => {
    const addition: BatchAddition = {
      addition_type: "fining",
      ingredient_name: "Biofine Clear",
      quantity: 50,
      unit: "ml",
      timestamp: "2024-01-15T10:00:00Z",
    };
    expect(formatAddition(addition)).toBe("50 ml Biofine Clear (Fining)");
  });

  it("handles zero contact time as falsy", () => {
    const addition: BatchAddition = {
      addition_type: "dry_hop",
      ingredient_name: "Citra",
      quantity: 3,
      unit: "oz",
      timestamp: "2024-01-15T10:00:00Z",
      contact_time_hours: 0,
    };
    expect(formatAddition(addition)).toBe("3 oz Citra (Dry Hop)");
  });
});

describe("ADDITION_TYPES", () => {
  it("has all expected types", () => {
    expect(Object.keys(ADDITION_TYPES)).toEqual([
      "dry_hop", "fruit", "adjunct", "fining", "spice", "other",
    ]);
  });

  it("dry_hop shows contact time", () => {
    expect(ADDITION_TYPES.dry_hop.showContactTime).toBe(true);
  });

  it("other has no catalog table", () => {
    expect(ADDITION_TYPES.other.catalogTable).toBeNull();
  });
});

describe("UNIT_OPTIONS", () => {
  it("includes common weight and volume units", () => {
    const values = UNIT_OPTIONS.map((o) => o.value);
    expect(values).toContain("oz");
    expect(values).toContain("lb");
    expect(values).toContain("g");
    expect(values).toContain("kg");
    expect(values).toContain("ml");
    expect(values).toContain("l");
    expect(values).toContain("each");
  });
});
