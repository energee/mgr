/**
 * Characterization tests for vessel-transfer grouping and duplicate detection.
 * Locks in current behavior ahead of the src/domain/ move.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  groupVesselsForTransfer,
  isDuplicateTransfer,
} from "../vessel-transfer-utils";

type V = { id: string; vessel_type: string };
const v = (id: string, vessel_type: string): V => ({ id, vessel_type });

describe("groupVesselsForTransfer", () => {
  it("returns [] for no vessels", () => {
    expect(groupVesselsForTransfer([], "fermenting")).toEqual([]);
  });

  it("groups by type alphabetically when no batch status", () => {
    const groups = groupVesselsForTransfer([
      v("1", "tank"),
      v("2", "brite"),
      v("3", "tank"),
    ]);
    expect(groups).toEqual([
      { vesselType: "brite", vessels: [v("2", "brite")], preferred: false },
      {
        vesselType: "tank",
        vessels: [v("1", "tank"), v("3", "tank")],
        preferred: false,
      },
    ]);
  });

  it("puts preferred types first in preference order, rest alphabetical", () => {
    const groups = groupVesselsForTransfer(
      [v("1", "tank"), v("2", "brite"), v("3", "foeder"), v("4", "aging")],
      "fermenting"
    );
    expect(groups.map((g) => [g.vesselType, g.preferred])).toEqual([
      ["brite", true],
      ["foeder", true],
      ["aging", false],
      ["tank", false],
    ]);
  });

  it("omits preferred types with no vessels", () => {
    const groups = groupVesselsForTransfer([v("1", "brite")], "fermenting");
    expect(groups.map((g) => g.vesselType)).toEqual(["brite"]);
  });

  it("preserves input order within a group", () => {
    const groups = groupVesselsForTransfer(
      [v("b", "tank"), v("a", "tank")],
      null
    );
    expect(groups[0].vessels.map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("treats an unknown status like no status", () => {
    const groups = groupVesselsForTransfer(
      [v("1", "brite"), v("2", "aging")],
      "packaged"
    );
    expect(groups.map((g) => [g.vesselType, g.preferred])).toEqual([
      ["aging", false],
      ["brite", false],
    ]);
  });

  it("handles undefined/null/empty-string status", () => {
    for (const status of [undefined, null, ""] as const) {
      expect(
        groupVesselsForTransfer([v("1", "brite")], status).map((g) => g.preferred)
      ).toEqual([false]);
    }
  });

  it("uses the planned and conditioning preference lists", () => {
    expect(
      groupVesselsForTransfer(
        [v("1", "brite"), v("2", "fermenter"), v("3", "foeder")],
        "planned"
      ).map((g) => g.vesselType)
    ).toEqual(["fermenter", "foeder", "brite"]);
    expect(
      groupVesselsForTransfer(
        [v("1", "fermenter"), v("2", "brite")],
        "conditioning"
      ).map((g) => [g.vesselType, g.preferred])
    ).toEqual([
      ["brite", true],
      ["fermenter", false],
    ]);
  });
});

describe("isDuplicateTransfer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const freeze = (iso: string) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
  };

  it("is false when there is no last transfer", () => {
    expect(isDuplicateTransfer(null)).toBe(false);
  });

  it("is true inside the default 5-minute window", () => {
    freeze("2026-07-13T12:00:00Z");
    expect(isDuplicateTransfer("2026-07-13T11:57:00Z")).toBe(true);
  });

  it("is false exactly at the window boundary", () => {
    freeze("2026-07-13T12:00:00Z");
    expect(isDuplicateTransfer("2026-07-13T11:55:00Z")).toBe(false);
  });

  it("is false outside the window", () => {
    freeze("2026-07-13T12:00:00Z");
    expect(isDuplicateTransfer("2026-07-13T11:00:00Z")).toBe(false);
  });

  it("honors a custom window", () => {
    freeze("2026-07-13T12:00:00Z");
    expect(isDuplicateTransfer("2026-07-13T11:50:00Z", 15)).toBe(true);
    expect(isDuplicateTransfer("2026-07-13T11:50:00Z", 1)).toBe(false);
  });

  it("returns false for a zero window even for a just-now transfer", () => {
    freeze("2026-07-13T12:00:00Z");
    expect(isDuplicateTransfer("2026-07-13T12:00:00Z", 0)).toBe(false);
  });

  it("does not treat a future timestamp (clock skew) as a duplicate", () => {
    freeze("2026-07-13T12:00:00Z");
    expect(isDuplicateTransfer("2026-07-13T23:00:00Z")).toBe(false);
  });

  it("does not treat an unparseable timestamp as a duplicate", () => {
    freeze("2026-07-13T12:00:00Z");
    expect(isDuplicateTransfer("not-a-date")).toBe(false);
  });
});
