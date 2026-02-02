/**
 * API Response Helpers
 *
 * Standardized JSON response builders for Next.js route handlers.
 */

import { NextResponse } from "next/server";

export interface PaginationMeta {
  page: number;
  per_page: number;
  total: number;
}

export interface SuccessBody<T> {
  data: T;
  meta?: PaginationMeta;
}

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function successResponse<T>(
  data: T,
  meta?: PaginationMeta,
  status: number = 200
): NextResponse<SuccessBody<T>> {
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
