/**
 * Unit tests for mapPackagableBatches — the pure mapping behind the
 * batch-first quick-add row (usePackagableBatches): flattens the
 * batch → recipe → brand embed, drops brandless rows, and sorts by
 * packaging readiness. The hook itself is a thin Supabase query and is
 * exercised through the packaging views.
 */

import { describe, it, expect, vi } from "vitest";

// use-packaging imports the Supabase browser client (asserts env at import
// time) for its query hooks; mock it since only the pure mapping is under test.
vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({
    from: () => ({ select: () => ({ data: [], error: null }) }),
  })),
}));

import {
  mapPackagableBatches,
  type RawPackagableBatchRow,
} from "@/hooks/use-packaging";

function row(
  overrides: Partial<RawPackagableBatchRow> & { id: string }
): RawPackagableBatchRow {
  return {
    batch_code: overrides.id.toUpperCase(),
    name: `Batch ${overrides.id}`,
    status: "conditioning",
    volume_bbl: 10,
    current_vessel_name: null,
    recipes: { brand_id: "brand-1", brands: { name: "Hazy IPA" } },
    ...overrides,
  };
}

describe("mapPackagableBatches", () => {
  it("flattens the recipe/brand embed into brand_id and brand_name", () => {
    const result = mapPackagableBatches([
      row({
        id: "b1",
        recipes: { brand_id: "brand-9", brands: { name: "Pilsner" } },
      }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "b1",
      brand_id: "brand-9",
      brand_name: "Pilsner",
    });
  });

  it("drops batches without a derivable brand (recipe or brand_id missing)", () => {
    const result = mapPackagableBatches([
      row({ id: "no-recipe", recipes: null }),
      row({
        id: "no-brand",
        recipes: { brand_id: null, brands: null },
      }),
      row({ id: "ok" }),
    ]);
    expect(result.map((b) => b.id)).toEqual(["ok"]);
  });

  it("keeps a brand-less name graceful (null) when the brands embed is missing", () => {
    const result = mapPackagableBatches([
      row({ id: "b1", recipes: { brand_id: "brand-1", brands: null } }),
    ]);
    expect(result[0].brand_name).toBeNull();
  });

  it("sorts by packaging readiness: conditioning, packaging, fermenting, planned, then unknown", () => {
    const result = mapPackagableBatches([
      row({ id: "p", status: "planned" }),
      row({ id: "u", status: "weird-status" }),
      row({ id: "f", status: "fermenting" }),
      row({ id: "c", status: "conditioning" }),
      row({ id: "k", status: "packaging" }),
    ]);
    expect(result.map((b) => b.id)).toEqual(["c", "k", "f", "p", "u"]);
  });
});
