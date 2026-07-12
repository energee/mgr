/**
 * escapeIlikePattern tests (audit DL-6, backlog #17).
 *
 * The helper turns a raw value into an exact-match `.ilike()` pattern — the
 * app-side equivalent of migration 00201's `lower() = lower()`. These pin the
 * metacharacter escaping that keeps the portal auto-link (and the user-invite
 * duplicate pre-check) from wildcard-matching the wrong row.
 */
import { describe, it, expect } from "vitest";
import { escapeIlikePattern } from "../query-helpers";

describe("escapeIlikePattern", () => {
  it("passes plain emails through unchanged", () => {
    expect(escapeIlikePattern("buyer@acme.com")).toBe("buyer@acme.com");
  });

  it("preserves case — ilike itself provides the case-insensitivity", () => {
    expect(escapeIlikePattern("Buyer@Acme.com")).toBe("Buyer@Acme.com");
  });

  it("escapes the LIKE wildcards _ and %", () => {
    expect(escapeIlikePattern("john_doe@acme.com")).toBe("john\\_doe@acme.com");
    expect(escapeIlikePattern("100%@acme.com")).toBe("100\\%@acme.com");
  });

  it("escapes backslashes so they cannot defuse other escapes", () => {
    expect(escapeIlikePattern("a\\b")).toBe("a\\\\b");
  });

  it("escapes * (PostgREST's % alias) so such values fail closed", () => {
    expect(escapeIlikePattern("a*b@x.com")).toBe("a\\*b@x.com");
  });

  it("escapes every occurrence, not just the first", () => {
    expect(escapeIlikePattern("__%%")).toBe("\\_\\_\\%\\%");
  });
});
