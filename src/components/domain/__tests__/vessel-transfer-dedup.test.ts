import { describe, it, expect } from "vitest";
import { isDuplicateTransfer } from "@/components/domain/batch/vessel-transfer-utils";

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
