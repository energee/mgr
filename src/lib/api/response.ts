/**
 * API Response Helpers
 *
 * Standardized JSON response builders for Next.js route handlers.
 */

import { NextResponse } from "next/server";

export type PaginationMeta = {
  page: number;
  per_page: number;
  total: number;
}

export type SuccessBody<T> = {
  data: T;
  meta?: PaginationMeta;
}

export type ErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Statuses the WHATWG `Response` constructor forbids a body on. Serializing a
 * body for one throws a `TypeError`, which `withAuth` would convert into a 500
 * *after* the handler's write already committed — so short-circuit them.
 */
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

/**
 * Build a `{ data, meta? }` success response.
 *
 * Passing a null-body status (204/205/304) yields an empty-bodied response of
 * that status; `data` and `meta` are ignored, as the HTTP spec requires.
 */
export function successResponse<T>(
  data: T,
  meta?: PaginationMeta,
  status: number = 200
): NextResponse<SuccessBody<T>> {
  if (NULL_BODY_STATUSES.has(status)) {
    return new NextResponse(null, { status }) as NextResponse<SuccessBody<T>>;
  }
  return NextResponse.json({ data, ...(meta ? { meta } : {}) }, { status });
}

export function errorResponse(
  code: string,
  message: string,
  details?: unknown,
  status: number = 400
): NextResponse<ErrorBody> {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
      },
    },
    { status }
  );
}

export function paginatedResponse<T>(
  data: T[],
  page: number,
  perPage: number,
  total: number
): NextResponse<SuccessBody<T[]>> {
  return successResponse(data, { page, per_page: perPage, total });
}
