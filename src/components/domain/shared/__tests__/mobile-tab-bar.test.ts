/** Active-state logic for the mobile bottom tab bar. */
import { describe, expect, it } from "vitest";
import { isTabActive } from "@/components/domain/shared/mobile-tab-bar";

describe("isTabActive", () => {
  it("matches the exact path", () => {
    expect(isTabActive("/production/batches", "/production/batches")).toBe(true);
  });
  it("matches nested paths", () => {
    expect(isTabActive("/production/batches/abc-123", "/production/batches")).toBe(true);
  });
  it("does not match sibling prefixes", () => {
    expect(isTabActive("/production/batches-archive", "/production/batches")).toBe(false);
  });
  it("does not match other sections", () => {
    expect(isTabActive("/inventory/items", "/production/batches")).toBe(false);
  });
});
