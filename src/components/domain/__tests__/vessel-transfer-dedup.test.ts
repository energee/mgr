import { describe, it, expect } from "vitest";
import { isDuplicateTransfer, groupVesselsForTransfer } from "@/components/domain/batch/vessel-transfer-utils";

describe("isDuplicateTransfer", () => {
  it("returns false when no previous transfer exists", () => {
    expect(isDuplicateTransfer(null)).toBe(false);
  });

  it("returns true when last transfer was less than 5 minutes ago", () => {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60000).toISOString();
    expect(isDuplicateTransfer(twoMinutesAgo)).toBe(true);
  });

  it("returns false when last transfer was more than 5 minutes ago", () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60000).toISOString();
    expect(isDuplicateTransfer(tenMinutesAgo)).toBe(false);
  });

  it("returns true at exactly the boundary (< 5 minutes)", () => {
    const justUnder = new Date(Date.now() - 4.9 * 60000).toISOString();
    expect(isDuplicateTransfer(justUnder)).toBe(true);
  });

  it("returns false at exactly the boundary (>= 5 minutes)", () => {
    const justOver = new Date(Date.now() - 5.1 * 60000).toISOString();
    expect(isDuplicateTransfer(justOver)).toBe(false);
  });

  it("handles custom window sizes", () => {
    const threeMinutesAgo = new Date(Date.now() - 3 * 60000).toISOString();
    expect(isDuplicateTransfer(threeMinutesAgo, 2)).toBe(false);
    expect(isDuplicateTransfer(threeMinutesAgo, 10)).toBe(true);
  });
});

describe("groupVesselsForTransfer", () => {
  const v = (name: string, vessel_type: string) => ({ name, vessel_type });
  const cellar = [
    v("BT1", "brite"),
    v("FV1", "fermenter"),
    v("Foeder 1", "foeder"),
    v("MLT", "mash_tun"),
    v("BT2", "brite"),
  ];

  it("puts the expected next-stage types first for the batch status", () => {
    const groups = groupVesselsForTransfer(cellar, "fermenting");
    expect(groups.map((g) => g.vesselType)).toEqual([
      "brite",
      "foeder",
      "fermenter",
      "mash_tun",
    ]);
    expect(groups[0].preferred).toBe(true);
    expect(groups[0].vessels.map((x) => x.name)).toEqual(["BT1", "BT2"]);
    expect(groups[2].preferred).toBe(false);
  });

  it("falls back to alphabetical type order when the status has no preference", () => {
    const groups = groupVesselsForTransfer(cellar, "completed");
    expect(groups.map((g) => g.vesselType)).toEqual([
      "brite",
      "fermenter",
      "foeder",
      "mash_tun",
    ]);
    expect(groups.every((g) => !g.preferred)).toBe(true);
  });

  it("omits preferred types with no available vessels and handles empty input", () => {
    const groups = groupVesselsForTransfer([v("FV1", "fermenter")], "fermenting");
    expect(groups.map((g) => g.vesselType)).toEqual(["fermenter"]);
    expect(groupVesselsForTransfer([], "fermenting")).toEqual([]);
  });
});
