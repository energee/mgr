/**
 * Unit tests for the Getting Started checklist step builder.
 *
 * Covers group/step structure, done-flag wiring from entity counts,
 * route targets, and the progress summary used for the hide-when-complete
 * behavior.
 */

import { describe, it, expect } from "vitest";
import {
  buildChecklistGroups,
  checklistProgress,
  type OnboardingCounts,
} from "../checklist-steps";

const EMPTY_COUNTS: OnboardingCounts = {
  locations: 0,
  recipes: 0,
  batches: 0,
  brands: 0,
  containers: 0,
  sellingFormats: 0,
  pricingTiers: 0,
  customers: 0,
};

const FULL_COUNTS: OnboardingCounts = {
  locations: 1,
  recipes: 2,
  batches: 3,
  brands: 1,
  containers: 4,
  sellingFormats: 2,
  pricingTiers: 1,
  customers: 5,
};

describe("buildChecklistGroups", () => {
  it("returns a production group and a sales group", () => {
    const groups = buildChecklistGroups(EMPTY_COUNTS);
    expect(groups.map((g) => g.title)).toEqual(["Production", "Sales"]);
    expect(groups[0].steps).toHaveLength(3);
    expect(groups[1].steps).toHaveLength(5);
  });

  it("marks all steps not done when counts are zero", () => {
    const steps = buildChecklistGroups(EMPTY_COUNTS).flatMap((g) => g.steps);
    expect(steps.every((s) => !s.done)).toBe(true);
  });

  it("marks all steps done when every count is positive", () => {
    const steps = buildChecklistGroups(FULL_COUNTS).flatMap((g) => g.steps);
    expect(steps.every((s) => s.done)).toBe(true);
  });

  it("wires each count to its own step independently", () => {
    const groups = buildChecklistGroups({ ...EMPTY_COUNTS, pricingTiers: 2 });
    const sales = groups[1];
    const tierStep = sales.steps.find((s) => s.href === "/settings/pricing/tiers/new");
    expect(tierStep?.done).toBe(true);
    const otherSteps = groups
      .flatMap((g) => g.steps)
      .filter((s) => s.href !== "/settings/pricing/tiers/new");
    expect(otherSteps.every((s) => !s.done)).toBe(true);
  });

  it("links every step to a create route", () => {
    const hrefs = buildChecklistGroups(EMPTY_COUNTS).flatMap((g) => g.steps.map((s) => s.href));
    expect(hrefs).toEqual([
      "/settings/locations/new",
      "/production/recipes/new",
      "/production/batches/new",
      "/settings/brands/new",
      "/settings/containers/new",
      "/settings/selling-formats/new",
      "/settings/pricing/tiers/new",
      "/sales/customers/new",
    ]);
    // Every href is a /new create route (no dead-end list pages)
    expect(hrefs.every((h) => h.endsWith("/new"))).toBe(true);
  });
});

describe("checklistProgress", () => {
  it("reports zero completed for empty counts", () => {
    expect(checklistProgress(buildChecklistGroups(EMPTY_COUNTS))).toEqual({
      completed: 0,
      total: 8,
    });
  });

  it("reports full completion when all counts are positive", () => {
    const progress = checklistProgress(buildChecklistGroups(FULL_COUNTS));
    expect(progress.completed).toBe(progress.total);
  });

  it("counts partial completion across groups", () => {
    const groups = buildChecklistGroups({
      ...EMPTY_COUNTS,
      locations: 1,
      brands: 1,
      customers: 1,
    });
    expect(checklistProgress(groups)).toEqual({ completed: 3, total: 8 });
  });
});
