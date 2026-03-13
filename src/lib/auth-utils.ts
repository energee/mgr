/**
 * Shared auth utilities used by auth-related API routes.
 */

/**
 * Validates that a redirect path is safe (relative path only).
 * Prevents open redirect vulnerabilities.
 */
export function isValidRedirect(path: string): boolean {
  return (
    path.startsWith("/") &&
    !path.startsWith("//") &&
    !path.includes("://")
  );
}
