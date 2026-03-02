/**
 * API Utilities
 *
 * Re-exports all common API helpers for route handlers.
 *
 * Usage:
 *   import { withAuth, successResponse, validateBody, ApiError } from "@/lib/api";
 */

export { successResponse, errorResponse, paginatedResponse } from "./response";
export type { PaginationMeta, SuccessBody, ErrorBody } from "./response";

export { withAuth, withPermission } from "./auth";
export type { AuthContext, PermissionContext } from "./auth";

export {
  validateBody,
  validateParams,
  validateSearchParams,
} from "./validation";

export { ApiError, handleApiError } from "./errors";
export type { ApiErrorCode } from "./errors";

export { rateLimit, getClientIp } from "./rate-limit";
