/**
 * Tests for keyboard-wedge scan matching:
 * - matchScanCode (shared/scan-match.ts): trim/case-insensitive equality,
 *   null-code rows never match, empty scans match nothing
 * - resolvePickScan (order/pick-list-scan.ts): not_found / pick /
 *   already_picked resolution, first-unpicked-line preference when several
 *   pick lines share a lot number
 */

import { describe, it, expect } from "vitest";
import {
  matchScanCode,
  normalizeScanCode,
} from "@/components/domain/shared/scan-match";
import { resolvePickScan } from "@/components/domain/order/pick-list-scan";

describe("normalizeScanCode", () => {
  it("trims and lowercases", () => {
    expect(normalizeScanCode("  LOT-001 \n")).toBe("lot-001");
  });
});

describe("matchScanCode", () => {
  const rows = [
    { id: "a", lot: "LOT-001" },
    { id: "b", lot: "lot-002" },
    { id: "c", lot: null },
    { id: "d", lot: "LOT-001" },
  ];
  const getCode = (r: (typeof rows)[number]) => r.lot;

  it("matches case-insensitively with surrounding whitespace", () => {
    expect(matchScanCode(rows, " lot-001 ", getCode).map((r) => r.id)).toEqual(
      ["a", "d"]
    );
    expect(matchScanCode(rows, "LOT-002", getCode).map((r) => r.id)).toEqual([
      "b",
    ]);
  });

  it("returns empty for unknown, empty, or whitespace-only codes", () => {
    expect(matchScanCode(rows, "LOT-999", getCode)).toEqual([]);
    expect(matchScanCode(rows, "", getCode)).toEqual([]);
    expect(matchScanCode(rows, "   ", getCode)).toEqual([]);
  });

  it("never matches rows whose code is null/empty", () => {
    // Row "c" has a null code; scanning anything must not match it
    expect(matchScanCode(rows, "null", getCode)).toEqual([]);
    expect(
      matchScanCode([{ id: "e", lot: "" }], "", (r) => r.lot)
    ).toEqual([]);
  });
});

describe("resolvePickScan", () => {
  const line = (
    id: string,
    lot: string | null,
    picked: number,
    requested: number
  ) => ({
    id,
    lot_number: lot,
    quantity_picked: picked,
    quantity_requested: requested,
  });

  it("returns not_found when no line carries the lot", () => {
    const items = [line("a", "LOT-001", 0, 10)];
    expect(resolvePickScan(items, "LOT-XYZ")).toEqual({ kind: "not_found" });
  });

  it("returns pick with the matching unpicked line", () => {
    const items = [line("a", "LOT-001", 0, 10)];
    const result = resolvePickScan(items, "lot-001");
    expect(result.kind).toBe("pick");
    if (result.kind === "pick") expect(result.item.id).toBe("a");
  });

  it("prefers the first line with remaining quantity when lots are shared", () => {
    const items = [
      line("a", "LOT-001", 5, 5), // complete
      line("b", "LOT-001", 2, 8), // partially picked
      line("c", "LOT-001", 0, 3),
    ];
    const result = resolvePickScan(items, "LOT-001");
    expect(result.kind).toBe("pick");
    if (result.kind === "pick") expect(result.item.id).toBe("b");
  });

  it("returns already_picked once every matching line is complete", () => {
    const items = [line("a", "LOT-001", 5, 5), line("b", "LOT-001", 3, 3)];
    const result = resolvePickScan(items, "LOT-001");
    expect(result.kind).toBe("already_picked");
    if (result.kind === "already_picked") expect(result.item.id).toBe("a");
  });

  it("treats a partially picked line as pickable (re-scan tops it up)", () => {
    const items = [line("a", "LOT-001", 9, 10)];
    const result = resolvePickScan(items, "LOT-001");
    expect(result.kind).toBe("pick");
  });
});
