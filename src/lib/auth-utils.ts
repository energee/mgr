/**
 * Shared auth utilities used by auth pages and API routes.
 */

export const AUTH_CALLBACK_TYPE_RECOVERY = "recovery";

const LOGIN_EMAIL_STORAGE_KEY = "mgr:login-email";

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

export function readRememberedEmail(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(LOGIN_EMAIL_STORAGE_KEY) ?? "";
}

export function rememberEmail(email: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(LOGIN_EMAIL_STORAGE_KEY, email);
}
