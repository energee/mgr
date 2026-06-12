/**
 * Tests for the packaging revision draft math (src/domain/packaging-revision.ts):
 * draft parsing rules and the changed-lines / delta / error evaluation that
 * feeds the revise_packaging_session RPC payload.
 */

import { describe, it, expect } from "vitest";
import {
  parseReviseDraft,
  evaluateReviseDrafts,
  type RevisableLineItem,
} from "../packaging-revision";

describe("parseReviseDraft", () => {
  it("parses whole numbers", () => {
    expect(parseReviseDraft("30")).toEqual({ value: 30 });
    expect(parseReviseDraft(" 0 ")).toEqual({ value: 0 });
  });

  it("treats empty/whitespace as cleared (null)", () => {
    expect(parseReviseDraft("")).toEqual({ value: null });
    expect(parseReviseDraft("   ")).toEqual({ value: null });
  });

  it("rejects non-numeric, negative, and fractional entries", () => {
    expect(parseReviseDraft("abc").error).toBeDefined();
    expect(parseReviseDraft("1x").error).toBeDefined();
    expect(parseReviseDraft("-5").error).toBeDefined();
    expect(parseReviseDraft("2.5").error).toBeDefined();
  });

  it("rejects in-progress entries like '-' or '.'", () => {
    expect(parseReviseDraft("-").error).toBeDefined();
    expect(parseReviseDraft(".").error).toBeDefined();
  });
});

describe("evaluateReviseDrafts", () => {
  const items: RevisableLineItem[] = [
    { id: "a", actual_quantity: 300 },
    { id: "b", actual_quantity: 12 },
    { id: "c", actual_quantity: null },
  ];

  it("emits only changed lines with deltas", () => {
    const { changed, deltaByLine, errorByLine } = evaluateReviseDrafts(items, {
      a: "30", // the fat-finger fix: 300 -> 30
      b: "12", // unchanged
      c: "5", // null -> 5
    });
    expect(changed).toEqual([
      { line_item_id: "a", actual_quantity: 30 },
      { line_item_id: "c", actual_quantity: 5 },
    ]);
    expect(deltaByLine.get("a")).toBe(-270);
    expect(deltaByLine.get("b")).toBeUndefined();
    expect(deltaByLine.get("c")).toBe(5);
    expect(errorByLine.size).toBe(0);
  });

  it("treats missing drafts as untouched", () => {
    const { changed } = evaluateReviseDrafts(items, { a: "300" });
    expect(changed).toEqual([]);
  });

  it("clearing a recorded actual sends null", () => {
    const { changed, deltaByLine } = evaluateReviseDrafts(items, { b: "" });
    expect(changed).toEqual([{ line_item_id: "b", actual_quantity: null }]);
    expect(deltaByLine.get("b")).toBe(-12);
  });

  it("clearing an already-null actual is a no-op", () => {
    const { changed } = evaluateReviseDrafts(items, { c: "" });
    expect(changed).toEqual([]);
  });

  it("collects per-line errors without emitting those lines", () => {
    const { changed, errorByLine } = evaluateReviseDrafts(items, {
      a: "abc",
      b: "13",
    });
    expect(errorByLine.get("a")).toBeDefined();
    expect(changed).toEqual([{ line_item_id: "b", actual_quantity: 13 }]);
  });
});
