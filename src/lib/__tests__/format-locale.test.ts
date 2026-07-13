import { describe, it, expect } from "vitest";
import { formatValue } from "../format";

/**
 * Locale-pinning tests for formatValue date/datetime formatting.
 *
 * Regression for MGR-7 (Sentry SENTRY-7477285482): toLocaleDateString() without
 * an explicit locale produces different output on the Node.js server vs the
 * browser, causing React hydration errors. The fix pins the locale to "en-US"
 * so server and client always agree.
 *
 * Lives in its own file (rather than a general format.test.ts) because PR #281
 * introduces src/lib/__tests__/format.test.ts for formatRelativeDate on its own
 * branch; a separate path avoids a merge collision.
 */
describe("formatValue locale pinning", () => {
  const ISO_DATE = "2026-05-13T00:09:26.000Z";

  describe("format: date", () => {
    it("returns a consistent en-US date string", () => {
      const result = formatValue(ISO_DATE, "date");
      // en-US date format: M/D/YYYY
      expect(result).toMatch(/^\d{1,2}\/\d{1,2}\/\d{4}$/);
    });

    it("does not vary with the de-DE locale convention (D.M.YYYY)", () => {
      // Before the fix, toLocaleDateString() with no locale would produce
      // locale-dependent output — e.g. "13.5.2026" in de-DE environments.
      // The fixed formatValue always produces en-US output.
      const result = formatValue(ISO_DATE, "date");
      expect(result).not.toMatch(/^\d{1,2}\.\d{1,2}\.\d{4}$/);
    });

    it("formats date-only strings as the same calendar day (no UTC shift)", () => {
      // Regression: new Date("2026-07-15") is UTC midnight, which
      // toLocaleDateString renders as 7/14 in Americas timezones. PostgREST
      // returns `date` columns in exactly this shape.
      expect(formatValue("2026-07-15", "date")).toBe("7/15/2026");
      expect(formatValue("2026-01-01", "date")).toBe("1/1/2026");
      expect(formatValue("2026-12-31", "date")).toBe("12/31/2026");
    });

    it("returns em-dash for null", () => {
      expect(formatValue(null, "date")).toBe("—");
    });

    it("returns em-dash for undefined", () => {
      expect(formatValue(undefined, "date")).toBe("—");
    });
  });

  describe("format: datetime", () => {
    it("returns a consistent en-US datetime string", () => {
      const result = formatValue(ISO_DATE, "datetime");
      // en-US datetime contains AM/PM
      expect(result).toMatch(/[AP]M/i);
    });

    it("returns em-dash for null", () => {
      expect(formatValue(null, "datetime")).toBe("—");
    });
  });

  describe("no format (default)", () => {
    it("formats boolean true as 'Yes'", () => {
      expect(formatValue(true)).toBe("Yes");
    });

    it("formats boolean false as 'No'", () => {
      expect(formatValue(false)).toBe("No");
    });

    it("returns em-dash for null", () => {
      expect(formatValue(null)).toBe("—");
    });
  });
});
