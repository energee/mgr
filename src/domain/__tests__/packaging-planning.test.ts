/**
 * Unit tests for the React-free packaging-planning helpers that were not
 * already covered through the use-packaging hook tests:
 * buildFillVolumeMap (selling_format id → per-unit fill volume, dropping
 * formats without a usable container volume) and comparePackagingReadiness
 * (the batch sort comparator).
 *
 * Imports the domain module directly — no React, no Supabase client mock
 * needed, which is the point of the extraction.
 */

import { describe, it, expect } from "vitest";

import {
  buildFillVolumeMap,
  comparePackagingReadiness,
  type FillVolumeRow,
} from "@/domain/packaging-planning";

describe("buildFillVolumeMap", () => {
  it("maps each selling format id to its per-unit fill volume", () => {
    const rows: FillVolumeRow[] = [
      { id: "keg", unit_count: null, container: { volume_bbl: 0.5 } },
      {
        id: "case",
        unit_count: 24,
        container: { volume_bbl: null, volume_oz: 12 },
      },
    ];
    const map = buildFillVolumeMap(rows);
    expect(map.get("keg")).toBe(0.5);
    // 24 x 12oz / 3968 oz-per-bbl
    expect(map.get("case")).toBeCloseTo((24 * 12) / 3968, 9);
  });

  it("omits formats whose container volume is unusable", () => {
    const map = buildFillVolumeMap([
      { id: "no-container", unit_count: 24, container: null },
      { id: "no-volume", unit_count: 24, container: { volume_bbl: null } },
      { id: "zero-volume", unit_count: 24, container: { volume_bbl: 0 } },
      { id: "ok", unit_count: 1, container: { volume_bbl: 0.25 } },
    ]);
    expect([...map.keys()]).toEqual(["ok"]);
  });

  it("returns an empty map for no rows", () => {
    expect(buildFillVolumeMap([]).size).toBe(0);
  });
});

describe("comparePackagingReadiness", () => {
  it("sorts conditioning, packaging, fermenting, planned, then unknown", () => {
    const sorted = [
      { status: "planned" },
      { status: "weird-status" },
      { status: "fermenting" },
      { status: "conditioning" },
      { status: "packaging" },
    ].sort(comparePackagingReadiness);
    expect(sorted.map((b) => b.status)).toEqual([
      "conditioning",
      "packaging",
      "fermenting",
      "planned",
      "weird-status",
    ]);
  });

  it("treats a null status as unknown (sorts last)", () => {
    const sorted = [{ status: null }, { status: "planned" }].sort(
      comparePackagingReadiness
    );
    expect(sorted.map((b) => b.status)).toEqual(["planned", null]);
  });
});
