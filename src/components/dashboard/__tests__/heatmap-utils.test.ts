/**
 * Unit tests for heatmap pure helpers.
 *
 * Covers level bucketing, ISO-week aggregation, and deep-link URL building.
 */

import { describe, it, expect } from "vitest";
import {
  bucketForCount,
  bucketWeekly,
  buildPlannedDateFilterHref,
} from "../heatmap-utils";

describe("bucketForCount", () => {
  it("returns 0 for zero", () => {
    expect(bucketForCount(0)).toBe(0);
  });
  it("returns 1 for 1", () => {
    expect(bucketForCount(1)).toBe(1);
  });
  it("returns 2 for 2", () => {
    expect(bucketForCount(2)).toBe(2);
  });
  it("returns 3 for 3", () => {
    expect(bucketForCount(3)).toBe(3);
  });
  it("returns 4 for any value >= 4", () => {
    expect(bucketForCount(4)).toBe(4);
    expect(bucketForCount(7)).toBe(4);
    expect(bucketForCount(99)).toBe(4);
  });
});

describe("bucketWeekly", () => {
  it("groups daily values into ISO weeks (Mon-anchored)", () => {
    // 14 days starting Mon 2026-04-20
    const rows = Array.from({ length: 14 }, (_, i) => ({
      date: new Date(2026, 3, 20 + i).toISOString().slice(0, 10),
      value: 1,
    }));
    const out = bucketWeekly(rows);
    expect(out).toHaveLength(2);
    expect(out[0].value).toBe(7);
    expect(out[1].value).toBe(7);
  });

  it("zero-fills weeks with no data within the bounds", () => {
    const out = bucketWeekly([
      { date: "2026-04-20", value: 5 },
      // skip a week
      { date: "2026-05-04", value: 3 },
    ]);
    expect(out).toHaveLength(3);
    expect(out[0].value).toBe(5);
    expect(out[1].value).toBe(0);
    expect(out[2].value).toBe(3);
  });

  it("returns the ISO week's Monday as the bucket date", () => {
    const out = bucketWeekly([{ date: "2026-04-22", value: 1 }]);
    expect(out[0].date).toBe("2026-04-20");
  });

  it("returns empty array for empty input", () => {
    expect(bucketWeekly([])).toEqual([]);
  });
});

describe("buildPlannedDateFilterHref", () => {
  it("targets the batches list page", () => {
    const href = buildPlannedDateFilterHref("2026-03-12");
    expect(href.startsWith("/production/batches?")).toBe(true);
  });

  it("encodes a daterange isBetween filter for the given day", () => {
    const href = buildPlannedDateFilterHref("2026-03-12");
    const params = new URLSearchParams(href.split("?")[1]);
    const filters = JSON.parse(params.get("filters") ?? "[]");
    expect(filters).toHaveLength(1);
    expect(filters[0].id).toBe("planned_start_date");
    expect(filters[0].variant).toBe("dateRange");
    expect(filters[0].operator).toBe("isBetween");
    expect(filters[0].value).toEqual(["2026-03-12", "2026-03-12"]);
    expect(typeof filters[0].filterId).toBe("string");
    expect(filters[0].filterId.length).toBeGreaterThan(0);
  });
});
