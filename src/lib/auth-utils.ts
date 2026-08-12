/**
 * Shared auth utilities used by auth pages and API routes.
 */

export const AUTH_CALLBACK_TYPE_RECOVERY = "recovery";

const LOGIN_EMAIL_STORAGE_KEY = "mgr:login-email";

/**
 * Validates that a redirect path is safe (relative path only).
 * Prevents open redirect vulnerabilities.
 *
 * Rejects any value containing a backslash or an ASCII tab/CR/LF: WHATWG URL
 * parsing treats `\` as `/` for http(s) schemes, and strips tab/newline
 * characters entirely before parsing, so `new URL("/\\evil.example.com", origin)`
 * and `new URL("/\t/evil.example.com", origin)` both resolve to
 * `http://evil.example.com/` — protocol-relative references in disguise (#737).
 */
export function isValidRedirect(path: string): boolean {
  return (
    path.startsWith("/") &&
    !path.startsWith("//") &&
    !path.includes("://") &&
    !/[\\\t\n\r]/.test(path)
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

/**
 * Maps a Supabase `signInWithOtp` error message to a user-facing one.
 *
 * All login forms pass `shouldCreateUser: false` — accounts are invite-only
 * (staff via /api/users/invite, customers via the portal invite flow; audit
 * C1/M16, DL-2) — so Supabase rejects unknown emails with "Signups not
 * allowed for otp". Raw, that reads like a server misconfiguration to the
 * person locked out; surface a clear "no account" message instead. Other
 * errors (rate limits, etc.) pass through unchanged.
 */
export function otpSignInErrorMessage(message: string): string {
  return /signups not allowed/i.test(message)
    ? "No account found for this email — contact an administrator."
    : message;
}
