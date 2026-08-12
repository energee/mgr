/**
 * Tests for API validation utilities: validateBody, validateSearchParams.
 *
 * Exercises Zod-based parsing and error mapping to ApiError without requiring
 * live database or external service connections.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

import { validateBody, validateSearchParams } from "../validation";
import { ApiError } from "../errors";

// =============================================================================
// validateBody
// =============================================================================

describe("validateBody", () => {
  const schema = z.object({
    name: z.string().min(1),
    count: z.number().int().positive(),
  });

  it("parses a valid JSON body", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Pale Ale", count: 5 }),
    });

    const result = await validateBody(schema, request);
    expect(result).toEqual({ name: "Pale Ale", count: 5 });
  });

  it("throws ApiError with code VALIDATION_ERROR for invalid JSON body", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });

    await expect(validateBody(schema, request)).rejects.toThrow(ApiError);
    try {
      await validateBody(schema, request);
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.code).toBe("VALIDATION_ERROR");
      expect(apiErr.status).toBe(422);
      expect(apiErr.message).toBe("Invalid or missing JSON body");
    }
  });

  it("throws ApiError with field-level details for schema violations", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "", count: -1 }),
    });

    try {
      await validateBody(schema, request);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.code).toBe("VALIDATION_ERROR");
      expect(apiErr.status).toBe(422);
      expect(apiErr.message).toBe("Validation failed");
      expect(Array.isArray(apiErr.details)).toBe(true);
      const details = apiErr.details as Array<{ path: string; message: string }>;
      expect(details.length).toBeGreaterThanOrEqual(2);
      const paths = details.map((d) => d.path);
      expect(paths).toContain("name");
      expect(paths).toContain("count");
    }
  });

  it("throws ApiError when required fields are missing", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    await expect(validateBody(schema, request)).rejects.toThrow(ApiError);
  });
});

// =============================================================================
// validateSearchParams
// =============================================================================

describe("validateSearchParams", () => {
  const schema = z.object({
    page: z.string().optional(),
    status: z.string().optional(),
  });

  it("parses search params from request URL", () => {
    const request = new Request("http://localhost/api/items?page=2&status=active");
    const result = validateSearchParams(schema, request);
    expect(result).toEqual({ page: "2", status: "active" });
  });

  it("returns defaults for missing optional params", () => {
    const request = new Request("http://localhost/api/items");
    const result = validateSearchParams(schema, request);
    expect(result).toEqual({});
  });

  it("throws ApiError for invalid search params", () => {
    const strictSchema = z.object({
      page: z.string().regex(/^\d+$/),
    });
    const request = new Request("http://localhost/api/items?page=abc");

    expect(() => validateSearchParams(strictSchema, request)).toThrow(ApiError);
  });
});
