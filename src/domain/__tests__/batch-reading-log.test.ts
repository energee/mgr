/**
 * Tests for batch reading log ordering helpers — effective-timestamp
 * resolution (data.timestamp with created_at fallback) and newest-first sort.
 */

import { describe, it, expect } from "vitest";
import {
  readingLogTime,
  sortReadingLogsByTimestampDesc,
  type ReadingLogLike,
} from "../batch-reading-log";

const log = (created_at: string, timestamp?: string): ReadingLogLike => ({
  created_at,
  data: timestamp === undefined ? {} : { timestamp },
});

describe("readingLogTime", () => {
  it("prefers data.timestamp when present", () => {
    const l = log("2026-06-10T12:00:00Z", "2026-06-08T09:30");
    expect(readingLogTime(l)).toBe(new Date("2026-06-08T09:30").getTime());
  });

  it("falls back to created_at when timestamp is missing", () => {
    const l = log("2026-06-10T12:00:00Z");
    expect(readingLogTime(l)).toBe(new Date("2026-06-10T12:00:00Z").getTime());
  });

  it("falls back to created_at when timestamp is empty or unparseable", () => {
    expect(readingLogTime(log("2026-06-10T12:00:00Z", ""))).toBe(
      new Date("2026-06-10T12:00:00Z").getTime()
    );
    expect(readingLogTime(log("2026-06-10T12:00:00Z", "not-a-date"))).toBe(
      new Date("2026-06-10T12:00:00Z").getTime()
    );
  });
});

describe("sortReadingLogsByTimestampDesc", () => {
  it("orders newest-first by effective timestamp, not created_at", () => {
    // Backdated reading: entered today (created_at) but taken two days ago.
    const backdated = log("2026-06-10T12:00:00Z", "2026-06-08T09:00");
    const older = log("2026-06-09T08:00:00Z", "2026-06-09T08:00");
    const newest = log("2026-06-10T11:00:00Z", "2026-06-10T11:00");

    const sorted = sortReadingLogsByTimestampDesc([backdated, older, newest]);
    expect(sorted).toEqual([newest, older, backdated]);
  });

  it("mixes timestamp-bearing and fallback rows on one axis", () => {
    const noTimestamp = log("2026-06-09T12:00:00Z");
    const withTimestamp = log("2026-06-08T12:00:00Z", "2026-06-10T07:00");

    const sorted = sortReadingLogsByTimestampDesc([noTimestamp, withTimestamp]);
    expect(sorted).toEqual([withTimestamp, noTimestamp]);
  });

  it("does not mutate the input array", () => {
    const a = log("2026-06-09T12:00:00Z", "2026-06-09T12:00");
    const b = log("2026-06-10T12:00:00Z", "2026-06-10T12:00");
    const input = [a, b];
    sortReadingLogsByTimestampDesc(input);
    expect(input).toEqual([a, b]);
  });
});
