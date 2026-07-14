/**
 * Characterization tests for the order-allocation FIFO fill math.
 * Locks in current behavior ahead of the src/domain/ move.
 */

import { describe, it, expect } from "vitest";
import {
  comboKey,
  computeDemandLines,
  computeFifoFill,
  type AllocatableLot,
  type DemandLine,
} from "../order-allocation-utils";

const lot = (o: Partial<AllocatableLot> = {}): AllocatableLot => ({
  id: "lot-1",
  brand_id: "b1",
  selling_format_id: "f1",
  available_quantity: 10,
  production_date: "2026-01-01",
  ...o,
});

const line = (o: Partial<DemandLine> = {}): DemandLine => ({
  brandId: "b1",
  sellingFormatId: "f1",
  ordered: 10,
  allocated: 0,
  remaining: 10,
  ...o,
});

describe("comboKey", () => {
  it("joins ids with a colon", () => {
    expect(comboKey("b1", "f1")).toBe("b1:f1");
  });

  it("does not escape colons in ids (quirk: keys can collide)", () => {
    expect(comboKey("a:b", "c")).toBe(comboKey("a", "b:c"));
  });
});

describe("computeDemandLines", () => {
  it("returns [] for empty input", () => {
    expect(computeDemandLines([], [])).toEqual([]);
  });

  it("groups items by brand+format and nets out allocations", () => {
    const result = computeDemandLines(
      [
        { brand_id: "b1", selling_format_id: "f1", quantity: 10 },
        { brand_id: "b1", selling_format_id: "f1", quantity: 5 },
        { brand_id: "b2", selling_format_id: "f1", quantity: 3 },
      ],
      [{ brand_id: "b1", selling_format_id: "f1", quantity: 4 }]
    );
    expect(result).toEqual([
      {
        brandId: "b1",
        sellingFormatId: "f1",
        ordered: 15,
        allocated: 4,
        remaining: 11,
      },
      {
        brandId: "b2",
        sellingFormatId: "f1",
        ordered: 3,
        allocated: 0,
        remaining: 3,
      },
    ]);
  });

  it("skips TBD items missing brand or format", () => {
    expect(
      computeDemandLines(
        [
          { brand_id: null, selling_format_id: "f1", quantity: 10 },
          { brand_id: "b1", selling_format_id: null, quantity: 10 },
        ],
        []
      )
    ).toEqual([]);
  });

  it("treats null quantity as 0", () => {
    const [l] = computeDemandLines(
      [{ brand_id: "b1", selling_format_id: "f1", quantity: null }],
      [{ brand_id: "b1", selling_format_id: "f1", quantity: null }]
    );
    expect(l).toMatchObject({ ordered: 0, allocated: 0, remaining: 0 });
  });

  it("ignores allocations whose combo has no line", () => {
    const result = computeDemandLines(
      [{ brand_id: "b1", selling_format_id: "f1", quantity: 10 }],
      [
        { brand_id: "b9", selling_format_id: "f9", quantity: 100 },
        { brand_id: null, selling_format_id: "f1", quantity: 100 },
      ]
    );
    expect(result).toEqual([line({ ordered: 10, allocated: 0, remaining: 10 })]);
  });

  it("floors over-allocation at remaining 0 (allocated is preserved)", () => {
    const [l] = computeDemandLines(
      [{ brand_id: "b1", selling_format_id: "f1", quantity: 5 }],
      [{ brand_id: "b1", selling_format_id: "f1", quantity: 20 }]
    );
    expect(l).toMatchObject({ ordered: 5, allocated: 20, remaining: 0 });
  });

  it("preserves first-seen insertion order of combos", () => {
    const result = computeDemandLines(
      [
        { brand_id: "z", selling_format_id: "f", quantity: 1 },
        { brand_id: "a", selling_format_id: "f", quantity: 1 },
      ],
      []
    );
    expect(result.map((r) => r.brandId)).toEqual(["z", "a"]);
  });
});

describe("computeFifoFill", () => {
  it("returns {} with no lines or no lots", () => {
    expect(computeFifoFill([], [lot()])).toEqual({});
    expect(computeFifoFill([line()], [])).toEqual({});
  });

  it("consumes oldest production_date first, undated lots last", () => {
    const fill = computeFifoFill(
      [line({ ordered: 25, remaining: 25 })],
      [
        lot({ id: "new", production_date: "2026-03-01", available_quantity: 10 }),
        lot({ id: "undated", production_date: null, available_quantity: 10 }),
        lot({ id: "old", production_date: "2026-01-01", available_quantity: 10 }),
      ]
    );
    expect(Object.keys(fill)).toEqual(["old", "new", "undated"]);
    expect(fill).toEqual({ old: 10, new: 10, undated: 5 });
  });

  it("takes LEAST(remaining, available) and stops when the line is filled", () => {
    const fill = computeFifoFill(
      [line({ ordered: 4, remaining: 4 })],
      [
        lot({ id: "a", available_quantity: 10, production_date: "2026-01-01" }),
        lot({ id: "b", available_quantity: 10, production_date: "2026-02-01" }),
      ]
    );
    expect(fill).toEqual({ a: 4 });
  });

  it("skips excluded lots entirely", () => {
    const fill = computeFifoFill(
      [line({ ordered: 10, remaining: 10 })],
      [
        lot({ id: "a", production_date: "2026-01-01" }),
        lot({ id: "b", production_date: "2026-02-01" }),
      ],
      new Set(["a"])
    );
    expect(fill).toEqual({ b: 10 });
  });

  it("ignores lots whose combo has no demand line", () => {
    expect(
      computeFifoFill([line()], [lot({ id: "x", brand_id: "other" })])
    ).toEqual({});
  });

  it("skips lots with zero or negative availability", () => {
    expect(
      computeFifoFill(
        [line()],
        [
          lot({ id: "zero", available_quantity: 0 }),
          lot({ id: "neg", available_quantity: -5, production_date: "2026-02-01" }),
        ]
      )
    ).toEqual({});
  });

  it("skips lines with zero/negative remaining", () => {
    expect(
      computeFifoFill([line({ ordered: 0, remaining: 0 })], [lot()])
    ).toEqual({});
    expect(
      computeFifoFill([line({ remaining: -3 })], [lot()])
    ).toEqual({});
  });

  it("sums demand when duplicate combos are supplied", () => {
    const fill = computeFifoFill(
      [line({ remaining: 10 }), line({ remaining: 2 })],
      [lot({ available_quantity: 10 })]
    );
    expect(fill).toEqual({ "lot-1": 10 });
  });

  it("does not mutate the input lots array order", () => {
    const lots = [
      lot({ id: "b", production_date: "2026-02-01" }),
      lot({ id: "a", production_date: "2026-01-01" }),
    ];
    computeFifoFill([line({ remaining: 100 })], lots);
    expect(lots.map((l) => l.id)).toEqual(["b", "a"]);
  });
});
