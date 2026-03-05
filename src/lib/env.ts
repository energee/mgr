/**
 * Shared environment variable helpers.
 *
 * Centralizes env var access patterns used across multiple API routes
 * to prevent drift between duplicate definitions.
 */

/** Base URL for invite redirects and magic-link callbacks. */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "http://localhost:3000";
