/**
 * Tests for API utilities: rate limiting, error parsing, and API error handling.
 *
 * These tests validate request/response shapes, error mapping, and input
 * validation without requiring live database or external service connections.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { rateLimit, getClientIp } from "../api/rate-limit";
import { ApiError, handleApiError } from "../api/errors";
import {
  PG_ERROR_CODES,
} from "../errors";

// =============================================================================
// Helpers
// =============================================================================

// =============================================================================
// Rate Limiter Tests
// =============================================================================

describe("rateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests within the limit", () => {
    const id = `test-allow-${Date.now()}`;
    const result = rateLimit(id, { maxRequests: 5, windowMs: 60_000 });

    expect(result.success).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it("blocks requests exceeding the limit", () => {
    const id = `test-block-${Date.now()}`;
    const config = { maxRequests: 3, windowMs: 60_000 };

    // Exhaust all 3 allowed requests
    rateLimit(id, config);
    rateLimit(id, config);
    rateLimit(id, config);

    // Fourth request should be blocked
    const blocked = rateLimit(id, config);
    expect(blocked.success).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("returns correct remaining count", () => {
    const id = `test-remaining-${Date.now()}`;
    const config = { maxRequests: 5, windowMs: 60_000 };

    expect(rateLimit(id, config).remaining).toBe(4);
    expect(rateLimit(id, config).remaining).toBe(3);
    expect(rateLimit(id, config).remaining).toBe(2);
    expect(rateLimit(id, config).remaining).toBe(1);
    expect(rateLimit(id, config).remaining).toBe(0);

    // Next request is blocked
    const blocked = rateLimit(id, config);
    expect(blocked.success).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("resets after the window expires", () => {
    const id = `test-reset-${Date.now()}`;
    const windowMs = 10_000;
    const config = { maxRequests: 2, windowMs };

    // Use both allowed requests
    rateLimit(id, config);
    rateLimit(id, config);
    expect(rateLimit(id, config).success).toBe(false);

    // Advance past the window
    vi.advanceTimersByTime(windowMs + 1);

    // Should be allowed again after window expiry
    const afterReset = rateLimit(id, config);
    expect(afterReset.success).toBe(true);
    expect(afterReset.remaining).toBe(1);
  });

  it("returns resetMs indicating when the earliest request expires", () => {
    const id = `test-resetMs-${Date.now()}`;
    const config = { maxRequests: 2, windowMs: 30_000 };

    const first = rateLimit(id, config);
    expect(first.success).toBe(true);
    // resetMs should be close to the full window since it was just recorded
    expect(first.resetMs).toBeGreaterThan(0);
    expect(first.resetMs).toBeLessThanOrEqual(30_000);
  });
});

// =============================================================================
// getClientIp Tests
// =============================================================================

describe("getClientIp", () => {
  it("extracts IP from x-forwarded-for header", () => {
    const request = new Request("http://localhost", {
      headers: { "x-forwarded-for": "203.0.113.50" },
    });
    expect(getClientIp(request)).toBe("203.0.113.50");
  });

  it("extracts last IP from x-forwarded-for with multiple entries", () => {
    const request = new Request("http://localhost", {
      headers: { "x-forwarded-for": "203.0.113.50, 70.41.3.18, 150.172.238.178" },
    });
    expect(getClientIp(request)).toBe("150.172.238.178");
  });

  it("extracts IP from x-real-ip header", () => {
    const request = new Request("http://localhost", {
      headers: { "x-real-ip": "198.51.100.42" },
    });
    expect(getClientIp(request)).toBe("198.51.100.42");
  });

  it("prefers x-real-ip over x-forwarded-for", () => {
    const request = new Request("http://localhost", {
      headers: {
        "x-forwarded-for": "203.0.113.50",
        "x-real-ip": "198.51.100.42",
      },
    });
    expect(getClientIp(request)).toBe("198.51.100.42");
  });

  it('returns "unknown" when no IP headers are present', () => {
    const request = new Request("http://localhost");
    expect(getClientIp(request)).toBe("unknown");
  });
});

// =============================================================================
// parsePostgresError Tests (from src/lib/errors.ts)
// =============================================================================

// =============================================================================
// Type Guard Tests (from src/lib/errors.ts)
// =============================================================================

// =============================================================================
// Custom Error Classes (from src/lib/errors.ts)
// =============================================================================

// =============================================================================
// ApiError Tests (from src/lib/api/errors.ts)
// =============================================================================

describe("ApiError", () => {
  it("creates error with explicit code, message, and status", () => {
    const err = new ApiError("NOT_FOUND", "Resource not found", 404);
    expect(err.name).toBe("ApiError");
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("Resource not found");
    expect(err.status).toBe(404);
    expect(err).toBeInstanceOf(Error);
  });

  it("uses default status when not explicitly provided", () => {
    expect(new ApiError("UNAUTHORIZED", "No token").status).toBe(401);
    expect(new ApiError("FORBIDDEN", "Denied").status).toBe(403);
    expect(new ApiError("NOT_FOUND", "Missing").status).toBe(404);
    expect(new ApiError("VALIDATION_ERROR", "Bad input").status).toBe(422);
    expect(new ApiError("CONFLICT", "Duplicate").status).toBe(409);
    expect(new ApiError("INTERNAL_ERROR", "Boom").status).toBe(500);
  });

  it("stores optional details", () => {
    const details = { fields: ["email", "name"] };
    const err = new ApiError("VALIDATION_ERROR", "Invalid", undefined, details);
    expect(err.details).toEqual({ fields: ["email", "name"] });
  });

  it("has undefined details when not provided", () => {
    const err = new ApiError("NOT_FOUND", "Gone");
    expect(err.details).toBeUndefined();
  });
});

// =============================================================================
// handleApiError Tests (from src/lib/api/errors.ts)
// =============================================================================

describe("handleApiError", () => {
  it("returns ApiError directly when given an ApiError", () => {
    const original = new ApiError("NOT_FOUND", "Not found", 404);
    const result = handleApiError(original);
    expect(result).toBe(original);
    expect(result.status).toBe(404);
    expect(result.code).toBe("NOT_FOUND");
  });

  it("maps Postgres unique violation to CONFLICT 409", () => {
    const pgError = { code: "23505", message: "duplicate key" };
    const result = handleApiError(pgError);
    expect(result.code).toBe("CONFLICT");
    expect(result.status).toBe(409);
    expect(result.details).toEqual({ pg_code: "23505" });
  });

  it("maps Postgres foreign key violation to CONFLICT 409", () => {
    const pgError = { code: "23503", message: "foreign key violation" };
    const result = handleApiError(pgError);
    expect(result.code).toBe("CONFLICT");
    expect(result.status).toBe(409);
  });

  it("maps Postgres not-null violation to VALIDATION_ERROR 422", () => {
    const pgError = { code: "23502", message: "not-null constraint" };
    const result = handleApiError(pgError);
    expect(result.code).toBe("VALIDATION_ERROR");
    expect(result.status).toBe(422);
  });

  it("maps Postgres check violation to VALIDATION_ERROR 422", () => {
    const pgError = { code: "23514", message: "check constraint" };
    const result = handleApiError(pgError);
    expect(result.code).toBe("VALIDATION_ERROR");
    expect(result.status).toBe(422);
  });

  it("maps Postgres insufficient privilege to FORBIDDEN 403", () => {
    const pgError = { code: "42501", message: "permission denied" };
    const result = handleApiError(pgError);
    expect(result.code).toBe("FORBIDDEN");
    expect(result.status).toBe(403);
  });

  it("maps generic Error instances to INTERNAL_ERROR 500", () => {
    const err = new Error("Something broke");
    const result = handleApiError(err);
    expect(result.code).toBe("INTERNAL_ERROR");
    expect(result.status).toBe(500);
    expect(result.message).toBe("Something broke");
  });

  it("maps unknown non-Error values to INTERNAL_ERROR 500", () => {
    const result = handleApiError("string error");
    expect(result.code).toBe("INTERNAL_ERROR");
    expect(result.status).toBe(500);
    expect(result.message).toBe("An unexpected error occurred");
  });

  it("maps null/undefined to INTERNAL_ERROR 500", () => {
    expect(handleApiError(null).status).toBe(500);
    expect(handleApiError(undefined).status).toBe(500);
  });

  it("maps unrecognized Postgres error codes to INTERNAL_ERROR via Error fallback", () => {
    // An object with .code that isn't in PG_ERROR_MAP but is still a Postgres-like error
    // Falls through isPostgresError check but has no mapping, then hits Error check
    const pgError = { code: "99999", message: "unusual pg error" };
    const result = handleApiError(pgError);
    // Since it passes isPostgresError but has no mapping, falls through to Error check.
    // It's not an Error instance, so it hits the final fallback.
    expect(result.code).toBe("INTERNAL_ERROR");
    expect(result.status).toBe(500);
  });
});

// =============================================================================
// PG_ERROR_CODES constant integrity
// =============================================================================

describe("PG_ERROR_CODES", () => {
  it("contains expected constraint violation codes", () => {
    expect(PG_ERROR_CODES.UNIQUE_VIOLATION).toBe("23505");
    expect(PG_ERROR_CODES.FOREIGN_KEY_VIOLATION).toBe("23503");
    expect(PG_ERROR_CODES.CHECK_VIOLATION).toBe("23514");
    expect(PG_ERROR_CODES.NOT_NULL_VIOLATION).toBe("23502");
  });

  it("contains access error codes", () => {
    expect(PG_ERROR_CODES.INSUFFICIENT_PRIVILEGE).toBe("42501");
  });
});
