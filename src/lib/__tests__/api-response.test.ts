/**
 * Tests for API response helpers.
 *
 * Validates the shape and status codes of successResponse, errorResponse,
 * and paginatedResponse utilities.
 */

import { describe, it, expect } from "vitest";
import {
  successResponse,
  errorResponse,
  paginatedResponse,
} from "@/lib/api/response";

// ---------------------------------------------------------------------------
// successResponse
// ---------------------------------------------------------------------------

describe("successResponse", () => {
  it("returns 200 with data by default", async () => {
    const res = successResponse({ id: "abc" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({ id: "abc" });
    expect(body.meta).toBeUndefined();
  });

  it("includes meta when provided", async () => {
    const meta = { page: 1, per_page: 20, total: 100 };
    const res = successResponse([1, 2, 3], meta);
    const body = await res.json();

    expect(body.data).toEqual([1, 2, 3]);
    expect(body.meta).toEqual(meta);
  });

  it("allows custom status code", async () => {
    const res = successResponse(null, undefined, 201);
    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// errorResponse
// ---------------------------------------------------------------------------

describe("errorResponse", () => {
  it("returns structured error with default 400 status", async () => {
    const res = errorResponse("VALIDATION_ERROR", "Name is required");
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe("Name is required");
    expect(body.error.details).toBeUndefined();
  });

  it("includes details when provided", async () => {
    const details = { fields: ["email"] };
    const res = errorResponse("VALIDATION_ERROR", "Invalid", details, 422);
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error.details).toEqual({ fields: ["email"] });
  });

  it("allows custom status code", async () => {
    const res = errorResponse("NOT_FOUND", "Gone", undefined, 404);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// paginatedResponse
// ---------------------------------------------------------------------------

describe("paginatedResponse", () => {
  it("wraps data with pagination meta", async () => {
    const items = [{ id: 1 }, { id: 2 }];
    const res = paginatedResponse(items, 2, 10, 50);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual(items);
    expect(body.meta).toEqual({ page: 2, per_page: 10, total: 50 });
  });

  it("handles empty data array", async () => {
    const res = paginatedResponse([], 1, 20, 0);
    const body = await res.json();

    expect(body.data).toEqual([]);
    expect(body.meta.total).toBe(0);
  });
});
