import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatRelativeDate } from "../format";

describe("formatRelativeDate", () => {
  // Pin "now" to a fixed wall-clock so calendar-bucket assertions are
  // deterministic regardless of the host machine's date/locale.
  // Chosen: Wed Oct 15 2025 14:00:00 UTC (a weekday, well away from DST flips).
  const NOW = new Date("2025-10-15T14:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns empty string for null / undefined", () => {
    expect(formatRelativeDate(null)).toBe("");
    expect(formatRelativeDate(undefined)).toBe("");
  });

  it("returns empty string for an invalid date", () => {
    expect(formatRelativeDate("not-a-date")).toBe("");
    expect(formatRelativeDate(Number.NaN)).toBe("");
  });

  it("formats same-day timestamps as a time of day", () => {
    // 90 minutes earlier, same calendar day.
    const sameDay = new Date(NOW.getTime() - 90 * 60 * 1000);
    const result = formatRelativeDate(sameDay);
    // Time strings vary by environment punctuation, but must include a digit
    // and an AM/PM marker for the en-US locale.
    expect(result).toMatch(/\d/);
    expect(result).toMatch(/AM|PM/);
  });

  it("returns 'Yesterday' for a timestamp just past midnight on the previous calendar day", () => {
    // 1 minute into yesterday — would have been bucketed as "today" by the
    // old ms-division logic that this helper replaces.
    const startOfYesterdayPlusOne = new Date(NOW);
    startOfYesterdayPlusOne.setDate(NOW.getDate() - 1);
    startOfYesterdayPlusOne.setHours(0, 1, 0, 0);
    expect(formatRelativeDate(startOfYesterdayPlusOne)).toBe("Yesterday");
  });

  it("returns a time-of-day for a timestamp just after midnight today", () => {
    // Same calendar day as NOW but ~14h earlier — isToday keeps it in the
    // today bucket where elapsed-ms division could not.
    const lateToday = new Date(NOW);
    lateToday.setHours(0, 1, 0, 0); // 00:01 today
    const result = formatRelativeDate(lateToday);
    expect(result).not.toBe("Yesterday");
    expect(result).toMatch(/AM|PM/);
  });

  it("returns a weekday name for timestamps 3 days ago", () => {
    const threeDaysAgo = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000);
    // NOW is Wed Oct 15 2025 → 3 days earlier is Sun Oct 12 2025.
    expect(formatRelativeDate(threeDaysAgo)).toBe("Sunday");
  });

  it("returns a short month-and-day for timestamps 8 days ago", () => {
    const eightDaysAgo = new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000);
    // NOW is Oct 15 → 8 days earlier is Oct 7.
    expect(formatRelativeDate(eightDaysAgo)).toBe("Oct 7");
  });

  it("falls through to a short month-and-day for future timestamps", () => {
    // Defensive: activity feeds shouldn't surface future dates, but the
    // helper must not bucket them as a recent weekday.
    const future = new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000);
    // NOW is Oct 15 → +3 days is Oct 18.
    expect(formatRelativeDate(future)).toBe("Oct 18");
  });
});
