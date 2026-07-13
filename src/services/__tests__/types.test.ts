// @vitest-environment node
/**
 * Service-layer types — error mapping tests
 *
 * `parseSupabaseError` and `formatServiceError` are the two ends of the
 * service error pipeline: every service turns a raw PostgREST error into a
 * typed `ServiceError` with the first, and every caller (toasts, chat tools,
 * transition side effects) renders it with the second. A wrong mapping is
 * invisible until a user sees "undefined" in a toast, so both are pinned
 * here variant by variant.
 */

import { describe, it, expect } from "vitest";
import type { ZodIssue } from "zod";
import { ok, err, parseSupabaseError, formatServiceError, type ServiceError } from "../types";

describe("ok / err", () => {
  it("builds a success result carrying data and invalidation hints", () => {
    const result = ok({ id: "b1" }, [["batches"], ["allocations"]]);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ id: "b1" });
      expect(result.invalidate).toEqual([["batches"], ["allocations"]]);
    }
  });

  it("defaults invalidation hints to an empty list", () => {
    const result = ok(42);
    expect(result.success && result.invalidate).toEqual([]);
  });

  it("builds a failure result carrying the typed error", () => {
    const result = err<number>({ code: "RLS_DENIED", message: "denied" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toEqual({ code: "RLS_DENIED", message: "denied" });
    }
  });
});

describe("parseSupabaseError", () => {
  it("maps 23503 to FK_VIOLATION, preserving the message", () => {
    expect(parseSupabaseError({ code: "23503", message: "violates fk" })).toEqual({
      code: "FK_VIOLATION",
      message: "violates fk",
    });
  });

  it("maps 42501 to RLS_DENIED", () => {
    expect(parseSupabaseError({ code: "42501", message: "insufficient privilege" })).toEqual({
      code: "RLS_DENIED",
      message: "insufficient privilege",
    });
  });

  it("maps 23505 to UNIQUE_VIOLATION", () => {
    expect(parseSupabaseError({ code: "23505", message: "duplicate key" })).toEqual({
      code: "UNIQUE_VIOLATION",
      message: "duplicate key",
    });
  });

  it("maps PGRST116 to NOT_FOUND with the caller's table/id context", () => {
    expect(
      parseSupabaseError({ code: "PGRST116", message: "no rows" }, { table: "batches", id: "b1" })
    ).toEqual({ code: "NOT_FOUND", table: "batches", id: "b1" });
  });

  it("falls back to 'unknown' table/id when NOT_FOUND has no context", () => {
    // The ?? fallbacks matter: a NOT_FOUND rendered without them would read
    // "Record not found in undefined".
    expect(parseSupabaseError({ code: "PGRST116", message: "no rows" })).toEqual({
      code: "NOT_FOUND",
      table: "unknown",
      id: "unknown",
    });
  });

  it("maps an unrecognized code to UNKNOWN, keeping the raw error as cause", () => {
    const raw = { code: "42P01", message: "relation does not exist" };
    const parsed = parseSupabaseError(raw);

    expect(parsed).toMatchObject({ code: "UNKNOWN", message: "relation does not exist" });
    expect(parsed).toHaveProperty("cause", raw);
  });

  it("maps a code-less error to UNKNOWN", () => {
    expect(parseSupabaseError({ message: "network down" })).toMatchObject({
      code: "UNKNOWN",
      message: "network down",
    });
  });
});

describe("formatServiceError", () => {
  it("joins every zod issue message for VALIDATION", () => {
    const issues = [
      { message: "Name is required" },
      { message: "Quantity must be positive" },
    ] as ZodIssue[];

    expect(formatServiceError({ code: "VALIDATION", issues })).toBe(
      "Validation failed: Name is required, Quantity must be positive"
    );
  });

  it("passes CONFLICT / INVALID_TRANSITION / UNKNOWN messages through verbatim", () => {
    expect(
      formatServiceError({ code: "CONFLICT", currentVersion: 3, message: "Record changed" })
    ).toBe("Record changed");
    expect(
      formatServiceError({
        code: "INVALID_TRANSITION",
        from: "draft",
        to: "fulfilled",
        message: "draft → fulfilled is not allowed",
      })
    ).toBe("draft → fulfilled is not allowed");
    expect(formatServiceError({ code: "UNKNOWN", message: "boom" })).toBe("boom");
  });

  it("renders UNIQUE_VIOLATION / FK_VIOLATION / RLS_DENIED as user-facing prose, not the raw PG message", () => {
    // The raw PG text ("duplicate key value violates unique constraint
    // ...") is useless in a toast — these three deliberately drop it.
    expect(formatServiceError({ code: "UNIQUE_VIOLATION", message: "duplicate key" })).toBe(
      "A record with that value already exists"
    );
    expect(formatServiceError({ code: "FK_VIOLATION", message: "violates fk" })).toBe(
      "Cannot complete: a related record constraint was violated"
    );
    expect(formatServiceError({ code: "RLS_DENIED", message: "42501" })).toBe(
      "You don't have permission to perform this action"
    );
  });

  it("names the table for NOT_FOUND", () => {
    expect(formatServiceError({ code: "NOT_FOUND", table: "orders", id: "o1" })).toBe(
      "Record not found in orders"
    );
  });

  it("returns a non-empty string for every ServiceError variant", () => {
    const variants: ServiceError[] = [
      { code: "VALIDATION", issues: [] },
      { code: "CONFLICT", currentVersion: 1, message: "c" },
      { code: "UNIQUE_VIOLATION", message: "u" },
      { code: "NOT_FOUND", table: "t", id: "i" },
      { code: "FK_VIOLATION", message: "f" },
      { code: "RLS_DENIED", message: "r" },
      { code: "INVALID_TRANSITION", from: "a", to: "b", message: "t" },
      { code: "UNKNOWN", message: "k" },
    ];

    for (const v of variants) {
      const msg = formatServiceError(v);
      expect(typeof msg).toBe("string");
      expect(msg.length).toBeGreaterThan(0);
      expect(msg).not.toContain("undefined");
    }
  });
});
