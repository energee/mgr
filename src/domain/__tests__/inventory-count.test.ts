/**
 * Tests for the cycle-count reconciliation math
 * (src/domain/inventory-count.ts): decrease/increase/none planning and
 * the audit-note helpers used when a count raises a lot's quantity.
 */

import { describe, it, expect } from "vitest";
import {
  planCountAdjustment,
  buildCountIncreaseNote,
  appendLotNote,
} from "@/domain/inventory-count";

describe("planCountAdjustment", () => {
  it("returns a decrease (shrinkage) when counted < expected", () => {
    expect(planCountAdjustment(100, 92.5)).toEqual({ kind: "decrease", delta: 7.5 });
  });

  it("returns an increase (found stock) when counted > expected", () => {
    expect(planCountAdjustment(10, 12)).toEqual({ kind: "increase", delta: 2 });
  });

  it("returns none on an exact match", () => {
    expect(planCountAdjustment(50, 50)).toEqual({ kind: "none", delta: 0 });
  });

  it("treats tiny float residue as a match (no noise adjustments)", () => {
    expect(planCountAdjustment(0.1 + 0.2, 0.3)).toEqual({ kind: "none", delta: 0 });
  });

  it("supports counting a lot down to zero (full shrinkage)", () => {
    expect(planCountAdjustment(25, 0)).toEqual({ kind: "decrease", delta: 25 });
  });

  it("supports found stock on a lot the system thinks is empty", () => {
    expect(planCountAdjustment(0, 3)).toEqual({ kind: "increase", delta: 3 });
  });

  it("rejects negative counted quantities", () => {
    expect(() => planCountAdjustment(10, -1)).toThrow(/negative/i);
  });

  it("rejects non-finite inputs", () => {
    expect(() => planCountAdjustment(Number.NaN, 1)).toThrow(/finite/i);
    expect(() => planCountAdjustment(1, Number.POSITIVE_INFINITY)).toThrow(/finite/i);
  });
});

describe("buildCountIncreaseNote", () => {
  it("formats the audit line with date, delta, counted, and expected", () => {
    expect(
      buildCountIncreaseNote({
        countedOn: "2026-06-12",
        expectedQuantity: 100,
        countedQuantity: 105,
      })
    ).toBe("[2026-06-12] Count adjustment: +5 (counted 105, expected 100)");
  });

  it("appends the counter's notes when provided", () => {
    expect(
      buildCountIncreaseNote({
        countedOn: "2026-06-12",
        expectedQuantity: 0,
        countedQuantity: 2.125,
        notes: "  found behind rack 3  ",
      })
    ).toBe(
      "[2026-06-12] Count adjustment: +2.125 (counted 2.125, expected 0) — found behind rack 3"
    );
  });

  it("rounds float residue out of the note quantities", () => {
    expect(
      buildCountIncreaseNote({
        countedOn: "2026-06-12",
        expectedQuantity: 0.1,
        countedQuantity: 0.1 + 0.2 + 0.1,
      })
    ).toBe("[2026-06-12] Count adjustment: +0.3 (counted 0.4, expected 0.1)");
  });
});

describe("appendLotNote", () => {
  it("returns the note alone when there are no existing notes", () => {
    expect(appendLotNote(null, "audit line")).toBe("audit line");
    expect(appendLotNote("   ", "audit line")).toBe("audit line");
  });

  it("appends on a new line after existing notes", () => {
    expect(appendLotNote("keep refrigerated", "audit line")).toBe(
      "keep refrigerated\naudit line"
    );
  });
});
