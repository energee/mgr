/**
 * API Utilities
 *
 * Re-exports the common API helpers consumed by route handlers through the
 * `@/lib/api` barrel. Helpers used only through their source module are
 * imported directly from there (e.g. `@/lib/api/auth`).
 *
 * Usage:
 *   import { withPermission, successResponse, validateBody, ApiError } from "@/lib/api";
 */

export { successResponse, errorResponse, paginatedResponse } from "./response";

export { withPermission } from "./auth";

export { validateBody, validateSearchParams } from "./validation";

export { ApiError } from "./errors";

export { rateLimit } from "./rate-limit";
