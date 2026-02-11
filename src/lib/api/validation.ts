/**
 * API Request Validation
 *
 * Zod-based validation helpers for route handler inputs.
 */

import { type ZodSchema, ZodError } from "zod";
import { ApiError } from "./errors";

export async function validateBody<T>(
  schema: ZodSchema<T>,
  request: Request
): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError("VALIDATION_ERROR", "Invalid or missing JSON body", 422);
  }

  return parseWithSchema(schema, body);
}

export function validateParams<T>(
  schema: ZodSchema<T>,
  params: unknown
): T {
  return parseWithSchema(schema, params);
}

export function validateSearchParams<T>(
  schema: ZodSchema<T>,
  request: Request
): T {
  const url = new URL(request.url);
  const entries = Object.fromEntries(url.searchParams.entries());
  return parseWithSchema(schema, entries);
}

function parseWithSchema<T>(schema: ZodSchema<T>, data: unknown): T {
  try {
    return schema.parse(data);
  } catch (err) {
    if (err instanceof ZodError) {
      const fieldErrors = err.issues.map((e) => ({
        path: e.path.join("."),
        message: e.message,
      }));
      throw new ApiError(
        "VALIDATION_ERROR",
        "Validation failed",
        422,
        fieldErrors
      );
    }
    throw err;
  }
}
