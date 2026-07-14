/**
 * Tests for planned-addition completion matching (planned-addition-matching.ts).
 *
 * Covers the catalog-id exact-match path (regression: the old code compared
 * row.catalog_id against the recipe junction row id, which never matched) and
 * the fuzzy-name fallback for custom-named entries.
 */

import { describe, it, expect } from "vitest";
import {
  isPlannedAdditionLogged,
  type LoggedAdditionRow,
  type PlannedAddition,
} from "../planned-addition-matching";

const plannedCitra: PlannedAddition = {
  id: "junction-row-1", // recipe_hops.id
  catalogId: "hop-citra", // recipe_hops.hop_id
  type: "dry_hop",
  name: "Citra",
  amount: 4,
  unit: "oz",
};

const row = (overrides: Partial<LoggedAdditionRow>): LoggedAdditionRow => ({
  addition_type: "hop",
  catalog_id: null,
  name: "",
  ...overrides,
});

describe("isPlannedAdditionLogged", () => {
  it("matches by catalog id even when the logged name differs", () => {
    const logged = [row({ catalog_id: "hop-citra", name: "Citra LUPOMAX 2024" })];
    expect(isPlannedAdditionLogged(plannedCitra, logged)).toBe(true);
  });

  it("does not match a junction row id stored as catalog_id (old-bug shape)", () => {
    // Pre-fix, the code compared row.catalog_id to planned.id (junction id) —
    // different ID spaces. A row carrying that id must not count as logged.
    const logged = [row({ catalog_id: "junction-row-1", name: "Mystery hop" })];
    expect(isPlannedAdditionLogged(plannedCitra, logged)).toBe(false);
  });

  it("does not fuzzy-match when both sides have catalog ids that differ", () => {
    // "Citra Cryo" name-contains "Citra" but is a different catalog item
    const logged = [row({ catalog_id: "hop-citra-cryo", name: "Citra Cryo" })];
    expect(isPlannedAdditionLogged(plannedCitra, logged)).toBe(false);
  });

  it("falls back to fuzzy name matching for custom-named (uncatalogued) rows", () => {
    const logged = [row({ catalog_id: null, name: "citra (freezer stash)" })];
    expect(isPlannedAdditionLogged(plannedCitra, logged)).toBe(true);
  });

  it("requires the addition type to map to the planned display type", () => {
    // Same catalog id but logged as fruit — type gate rejects it
    const logged = [
      row({ addition_type: "fruit", catalog_id: "hop-citra", name: "Citra" }),
    ];
    expect(isPlannedAdditionLogged(plannedCitra, logged)).toBe(false);
  });

  it("matches non-hop types via their own catalog ids", () => {
    const plannedRaspberry: PlannedAddition = {
      id: "junction-row-2",
      catalogId: "fruit-raspberry",
      type: "fruit",
      name: "Raspberry",
      amount: 10,
      unit: "lbs",
    };
    const logged = [
      row({
        addition_type: "fruit",
        catalog_id: "fruit-raspberry",
        name: "Raspberry Puree",
      }),
    ];
    expect(isPlannedAdditionLogged(plannedRaspberry, logged)).toBe(true);
  });

  it("returns false when nothing has been logged", () => {
    expect(isPlannedAdditionLogged(plannedCitra, [])).toBe(false);
  });
});
