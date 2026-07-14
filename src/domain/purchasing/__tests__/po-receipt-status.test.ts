/**
 * Characterization tests for the extracted PO receipt-status rules.
 *
 * These pin CURRENT behavior, quirks included. Several cases below assert what is plainly a
 * bug (an empty line list reporting "fulfilled", a null quantity counting as received). They
 * are asserted deliberately: the extraction from po-receiving.tsx had to be
 * behavior-preserving, so the defects move with the code and get fixed on purpose, in their
 * own change, rather than silently disappearing inside a refactor.
 */

import { describe, it, expect } from "vitest";
import {
  sumReceivedByLineItem,
  isAllFullyReceived,
  decideTargetStatus,
  type POLineItemQuantity,
} from "../po-receipt-status";

describe("sumReceivedByLineItem", () => {
  it("sums multiple receipts against the same line item", () => {
    const sums = sumReceivedByLineItem([
      { po_line_item_id: "a", quantity: 3 },
      { po_line_item_id: "a", quantity: 4 },
      { po_line_item_id: "b", quantity: 1 },
    ]);
    expect(sums.get("a")).toBe(7);
    expect(sums.get("b")).toBe(1);
  });

  it("returns an empty map for null/undefined/empty input", () => {
    expect(sumReceivedByLineItem(null).size).toBe(0);
    expect(sumReceivedByLineItem(undefined).size).toBe(0);
    expect(sumReceivedByLineItem([]).size).toBe(0);
  });
});

describe("decideTargetStatus", () => {
  const lines: POLineItemQuantity[] = [
    { id: "a", quantity: 10 },
    { id: "b", quantity: 5 },
  ];

  it("is fulfilled when every line is received in full", () => {
    expect(
      decideTargetStatus(lines, [
        { po_line_item_id: "a", quantity: 10 },
        { po_line_item_id: "b", quantity: 5 },
      ])
    ).toBe("fulfilled");
  });

  it("is partial when any line is short", () => {
    expect(
      decideTargetStatus(lines, [
        { po_line_item_id: "a", quantity: 10 },
        { po_line_item_id: "b", quantity: 4 },
      ])
    ).toBe("partial");
  });

  it("is partial when nothing has been received", () => {
    expect(decideTargetStatus(lines, [])).toBe("partial");
  });

  // --- Quirks preserved from the original implementation -----------------------

  it("QUIRK: over-receipt is uncapped and counts as fulfilled", () => {
    expect(
      decideTargetStatus([{ id: "a", quantity: 10 }], [{ po_line_item_id: "a", quantity: 999 }])
    ).toBe("fulfilled");
  });

  it("QUIRK: float drift leaves a line permanently partial (0.7 + 0.1 < 0.8)", () => {
    expect(
      decideTargetStatus(
        [{ id: "a", quantity: 0.8 }],
        [
          { po_line_item_id: "a", quantity: 0.7 },
          { po_line_item_id: "a", quantity: 0.1 },
        ]
      )
    ).toBe("partial");
  });

  it("QUIRK: an EMPTY line list reports fulfilled ([].every() is true)", () => {
    expect(decideTargetStatus([], [])).toBe("fulfilled");
  });

  it("QUIRK: a null quantity counts as fully received (0 >= null is true)", () => {
    const nullQty = [{ id: "a", quantity: null }] as unknown as POLineItemQuantity[];
    expect(decideTargetStatus(nullQty, [])).toBe("fulfilled");
  });

  it("QUIRK: a zero-quantity line is 'complete' with nothing received", () => {
    expect(decideTargetStatus([{ id: "a", quantity: 0 }], [])).toBe("fulfilled");
  });
});

describe("isAllFullyReceived", () => {
  it("treats a missing receipt entry as zero received", () => {
    expect(isAllFullyReceived([{ id: "a", quantity: 1 }], new Map())).toBe(false);
  });

  it("accepts exact equality", () => {
    expect(isAllFullyReceived([{ id: "a", quantity: 5 }], new Map([["a", 5]]))).toBe(true);
  });
});
