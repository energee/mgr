/**
 * Unit tests for the pure planned-quantity suggestion math in use-packaging:
 * computeUnitFillVolumeBbl (selling_formats → containers join math) and
 * suggestPlannedQuantity (floor(batch volume ÷ per-unit fill volume)).
 * The hooks themselves (useSellingFormatFillVolumes, useOpenPackagingSessions)
 * are thin Supabase queries and are exercised through the packaging dialogs.
 */

import { describe, it, expect, vi } from "vitest";

// use-packaging imports the Supabase browser client (asserts env at import
// time) for its query hooks; mock it since only the pure math is under test.
vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({
    from: () => ({ select: () => ({ data: [], error: null }) }),
  })),
}));

import {
  computeUnitFillVolumeBbl,
  suggestPlannedQuantity,
} from "@/hooks/use-packaging";

describe("computeUnitFillVolumeBbl", () => {
  it("multiplies container volume by unit count", () => {
    // Case of 24 × 12oz cans: 12oz ≈ 0.00302 BBL
    expect(
      computeUnitFillVolumeBbl({
        unit_count: 24,
        container: { volume_bbl: 0.003024 },
      })
    ).toBeCloseTo(0.072576, 6);
  });

  it("treats a null unit count as a single container (kegs)", () => {
    expect(
      computeUnitFillVolumeBbl({
        unit_count: null,
        container: { volume_bbl: 0.5 },
      })
    ).toBe(0.5);
  });

  it("returns null when container volume is missing or non-positive", () => {
    expect(
      computeUnitFillVolumeBbl({ unit_count: 24, container: null })
    ).toBeNull();
    expect(
      computeUnitFillVolumeBbl({
        unit_count: 24,
        container: { volume_bbl: null },
      })
    ).toBeNull();
    expect(
      computeUnitFillVolumeBbl({
        unit_count: 24,
        container: { volume_bbl: 0 },
      })
    ).toBeNull();
  });
});

describe("suggestPlannedQuantity", () => {
  it("floors the batch volume divided by the unit fill volume", () => {
    // 10 BBL batch into half-barrel kegs → 20
    expect(suggestPlannedQuantity(10, 0.5)).toBe(20);
    // 10 BBL batch into cases of 24 × 12oz → floor(137.78…) = 137
    expect(suggestPlannedQuantity(10, 0.072576)).toBe(137);
  });

  it("compensates for float division landing just under a whole number", () => {
    // 0.1 + 0.2 = 0.30000000000000004-style error: 3 × 0.1 / 0.1 should be 3
    expect(suggestPlannedQuantity(0.3, 0.1)).toBe(3);
  });

  it("returns null when either volume is unknown or non-positive", () => {
    expect(suggestPlannedQuantity(null, 0.5)).toBeNull();
    expect(suggestPlannedQuantity(undefined, 0.5)).toBeNull();
    expect(suggestPlannedQuantity(10, null)).toBeNull();
    expect(suggestPlannedQuantity(10, undefined)).toBeNull();
    expect(suggestPlannedQuantity(0, 0.5)).toBeNull();
    expect(suggestPlannedQuantity(-5, 0.5)).toBeNull();
    expect(suggestPlannedQuantity(10, 0)).toBeNull();
  });

  it("returns null instead of suggesting 0 when the batch fills no whole unit", () => {
    expect(suggestPlannedQuantity(0.25, 0.5)).toBeNull();
  });
});
