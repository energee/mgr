/**
 * Tests for the packaging-completion follow-up domain math (audit Q4,
 * findings 14 + 20): source-batch candidate dedupe/filtering, latest-gravity
 * SG extraction, and the actual_fg / actual_abv suggestion.
 */

import { describe, it, expect } from "vitest";
import { platoToSg } from "../units";
import {
  packagingBatchCandidates,
  latestGravitySg,
  suggestFgAbv,
  type SourceBatchRow,
  type GravityLogLike,
} from "../packaging-completion";

const row = (
  batchId: string | null,
  batch: Partial<NonNullable<SourceBatchRow["batch"]>> | null
): SourceBatchRow => ({
  batch_id: batchId,
  batch:
    batch === null
      ? null
      : {
          batch_code: null,
          status: null,
          actual_fg: null,
          actual_abv: null,
          ...batch,
        },
});

describe("packagingBatchCandidates", () => {
  it("dedupes line items to distinct batches in packaging status", () => {
    const rows = [
      row("b1", { batch_code: "B-001", status: "packaging" }),
      row("b1", { batch_code: "B-001", status: "packaging" }), // second format, same batch
      row("b2", { batch_code: "B-002", status: "packaging", actual_fg: 1.012 }),
    ];
    const candidates = packagingBatchCandidates(rows);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toEqual({
      batchId: "b1",
      batchCode: "B-001",
      actualFg: null,
      actualAbv: null,
    });
    expect(candidates[1].actualFg).toBe(1.012);
  });

  it("skips batches not in packaging status (already completed or shared)", () => {
    const rows = [
      row("b1", { batch_code: "B-001", status: "completed" }),
      row("b2", { batch_code: "B-002", status: "fermenting" }),
      row("b3", { batch_code: "B-003", status: "packaging" }),
    ];
    expect(packagingBatchCandidates(rows).map((c) => c.batchId)).toEqual(["b3"]);
  });

  it("skips rows without a batch and falls back to a truncated id for code", () => {
    const rows = [
      row(null, { status: "packaging" }),
      row("deadbeef-0000", null),
      row("cafebabe-1111", { status: "packaging", batch_code: null }),
    ];
    const candidates = packagingBatchCandidates(rows);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].batchCode).toBe("cafebabe");
  });
});

const gravityLog = (
  created_at: string,
  value: number | string,
  opts: { unit?: string; timestamp?: string; reading_type?: string } = {}
): GravityLogLike => ({
  created_at,
  data: {
    reading_type: opts.reading_type ?? "gravity",
    value,
    unit: opts.unit ?? "plato",
    ...(opts.timestamp ? { timestamp: opts.timestamp } : {}),
  },
});

describe("latestGravitySg", () => {
  it("converts the latest Plato reading to SG rounded to 3 decimals", () => {
    const logs = [
      gravityLog("2026-06-01T10:00:00Z", 12.0),
      gravityLog("2026-06-09T10:00:00Z", 2.5), // latest
    ];
    const expected = Math.round(platoToSg(2.5) * 1000) / 1000;
    expect(latestGravitySg(logs)).toBe(expected);
  });

  it("uses effective time so a backdated reading is not 'latest'", () => {
    const logs = [
      // Entered later but backdated to brew week — should NOT win
      gravityLog("2026-06-10T08:00:00Z", 12.0, { timestamp: "2026-06-01T09:00" }),
      gravityLog("2026-06-09T08:00:00Z", 2.5),
    ];
    const expected = Math.round(platoToSg(2.5) * 1000) / 1000;
    expect(latestGravitySg(logs)).toBe(expected);
  });

  it("passes SG-unit readings through without conversion", () => {
    expect(
      latestGravitySg([gravityLog("2026-06-09T10:00:00Z", 1.0123, { unit: "sg" })])
    ).toBe(1.012);
  });

  it("ignores non-gravity readings", () => {
    expect(
      latestGravitySg([
        gravityLog("2026-06-09T10:00:00Z", 68, { reading_type: "temperature" }),
      ])
    ).toBeNull();
  });

  it("returns null for empty, non-numeric, or implausible values", () => {
    expect(latestGravitySg([])).toBeNull();
    expect(
      latestGravitySg([gravityLog("2026-06-09T10:00:00Z", "n/a")])
    ).toBeNull();
    // 90°P converts to an SG far outside the plausible window
    expect(
      latestGravitySg([gravityLog("2026-06-09T10:00:00Z", 0.5, { unit: "sg" })])
    ).toBeNull();
  });
});

describe("suggestFgAbv", () => {
  it("suggests both FG and ABV when the batch has neither", () => {
    const suggestion = suggestFgAbv({
      latestSg: 1.012,
      actualOg: 1.052,
      existingFg: null,
      existingAbv: null,
    });
    expect(suggestion.actual_fg).toBe(1.012);
    // (1.052 - 1.012) * 131.25 = 5.25 -> 5.3
    expect(suggestion.actual_abv).toBe(5.3);
  });

  it("never overwrites an existing FG, but derives ABV from it", () => {
    const suggestion = suggestFgAbv({
      latestSg: 1.005,
      actualOg: 1.052,
      existingFg: 1.012,
      existingAbv: null,
    });
    expect(suggestion.actual_fg).toBeUndefined();
    expect(suggestion.actual_abv).toBe(5.3);
  });

  it("skips ABV when OG is missing or not above FG", () => {
    expect(
      suggestFgAbv({ latestSg: 1.012, actualOg: null, existingFg: null, existingAbv: null })
    ).toEqual({ actual_fg: 1.012 });
    expect(
      suggestFgAbv({ latestSg: 1.06, actualOg: 1.05, existingFg: null, existingAbv: null })
    ).toEqual({ actual_fg: 1.06 });
  });

  it("returns an empty patch when both values already exist or no data", () => {
    expect(
      suggestFgAbv({ latestSg: 1.012, actualOg: 1.052, existingFg: 1.01, existingAbv: 5.5 })
    ).toEqual({});
    expect(
      suggestFgAbv({ latestSg: null, actualOg: null, existingFg: null, existingAbv: null })
    ).toEqual({});
  });
});
