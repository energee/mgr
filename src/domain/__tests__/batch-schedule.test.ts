// @vitest-environment node
/**
 * Characterization tests for the batch-schedule domain module
 * (src/domain/batch-schedule.ts): recipe schedule-day resolution, phase-end
 * day math, and projected ready-date derivation, including default fallbacks.
 */

import { describe, it, expect } from "vitest";
import {
  scheduleDays,
  phaseEndDays,
  projectedReadyDate,
} from "../batch-schedule";

describe("scheduleDays", () => {
  it("returns recipe-specified fermentation and conditioning days", () => {
    expect(
      scheduleDays({ fermentation_days: 10, conditioning_days: 21 }),
    ).toEqual({ fermentationDays: 10, conditioningDays: 21 });
  });

  it("falls back to 14/7 defaults when recipe is null or undefined", () => {
    expect(scheduleDays(null)).toEqual({
      fermentationDays: 14,
      conditioningDays: 7,
    });
    expect(scheduleDays(undefined)).toEqual({
      fermentationDays: 14,
      conditioningDays: 7,
    });
  });

  it("falls back to defaults when fields are missing", () => {
    expect(scheduleDays({})).toEqual({
      fermentationDays: 14,
      conditioningDays: 7,
    });
  });

  it("falls back to defaults when fields are null", () => {
    expect(
      scheduleDays({ fermentation_days: null, conditioning_days: null }),
    ).toEqual({ fermentationDays: 14, conditioningDays: 7 });
  });

  it("falls back to defaults when fields are zero (falsy)", () => {
    expect(
      scheduleDays({ fermentation_days: 0, conditioning_days: 0 }),
    ).toEqual({ fermentationDays: 14, conditioningDays: 7 });
  });

  it("respects one field being set while the other falls back", () => {
    expect(scheduleDays({ fermentation_days: 5 })).toEqual({
      fermentationDays: 5,
      conditioningDays: 7,
    });
    expect(scheduleDays({ conditioning_days: 3 })).toEqual({
      fermentationDays: 14,
      conditioningDays: 3,
    });
  });
});

describe("phaseEndDays", () => {
  it("returns only fermentation days when status is 'fermenting'", () => {
    expect(
      phaseEndDays(
        { fermentation_days: 10, conditioning_days: 21 },
        "fermenting",
      ),
    ).toBe(10);
  });

  it("returns fermentation + conditioning days for conditioning status", () => {
    expect(
      phaseEndDays(
        { fermentation_days: 10, conditioning_days: 21 },
        "conditioning",
      ),
    ).toBe(31);
  });

  it("returns fermentation + conditioning days for any non-fermenting status (e.g. 'packaging')", () => {
    expect(
      phaseEndDays(
        { fermentation_days: 10, conditioning_days: 21 },
        "packaging",
      ),
    ).toBe(31);
  });

  it("treats null/undefined status as non-fermenting (uses total)", () => {
    expect(
      phaseEndDays({ fermentation_days: 10, conditioning_days: 21 }, null),
    ).toBe(31);
    expect(
      phaseEndDays(
        { fermentation_days: 10, conditioning_days: 21 },
        undefined,
      ),
    ).toBe(31);
  });

  it("uses default 14/7 days when recipe is null", () => {
    expect(phaseEndDays(null, "fermenting")).toBe(14);
    expect(phaseEndDays(null, "conditioning")).toBe(21);
  });
});

describe("projectedReadyDate", () => {
  it("returns null when plannedStartDate is null, undefined, or empty", () => {
    expect(projectedReadyDate(null, { fermentation_days: 10 })).toBeNull();
    expect(
      projectedReadyDate(undefined, { fermentation_days: 10 }),
    ).toBeNull();
    expect(projectedReadyDate("", { fermentation_days: 10 })).toBeNull();
  });

  it("adds fermentation + conditioning days to the start date using defaults", () => {
    // 2026-04-01 + 14 + 7 = 2026-04-22
    expect(projectedReadyDate("2026-04-01", null)).toBe("2026-04-22");
  });

  it("adds recipe-specified fermentation + conditioning days", () => {
    // 2026-04-01 + 10 + 21 = 2026-05-02
    expect(
      projectedReadyDate("2026-04-01", {
        fermentation_days: 10,
        conditioning_days: 21,
      }),
    ).toBe("2026-05-02");
  });

  it("correctly rolls over a month boundary", () => {
    // 2026-01-25 + 14 + 7 = 2026-02-15
    expect(projectedReadyDate("2026-01-25", null)).toBe("2026-02-15");
  });

  it("correctly rolls over a year boundary", () => {
    // 2026-12-25 + 14 + 7 = 2027-01-15
    expect(projectedReadyDate("2026-12-25", null)).toBe("2027-01-15");
  });

  it("correctly handles a leap-year February boundary", () => {
    // 2028 is a leap year: 2028-02-20 + 14 + 7 = 2028-03-12
    expect(projectedReadyDate("2028-02-20", null)).toBe("2028-03-12");
  });

  it("treats zero-value recipe fields as fallback (14/7), not zero duration", () => {
    expect(
      projectedReadyDate("2026-04-01", {
        fermentation_days: 0,
        conditioning_days: 0,
      }),
    ).toBe("2026-04-22");
  });
});
