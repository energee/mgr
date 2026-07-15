/**
 * Client-safe Logger
 *
 * Lightweight logger for browser-bundled code that wraps console methods
 * with a consistent API. Use this in client components and shared lib files.
 *
 * For server-only code (API routes), use `import { logger } from "@/lib/logger"`
 * which provides structured pino logging.
 *
 * Error and warn calls are also forwarded to Sentry (audit finding F-147)
 * so client-side bugs show up alongside server errors instead of only in the
 * user's devtools.
 */

import * as Sentry from "@sentry/nextjs";

// Supabase/postgrest-js represents both real Postgrest error responses and
// network-level fetch failures (DNS, offline, CORS) as a plain object literal
// — `{ message, details, hint, code }` — not an instance of `Error`, even
// though its TS type (`PostgrestError`) is declared as an `Error` subclass.
// See postgrest-js `PostgrestBuilder`'s fetch `.catch()` handler. Without this
// check, `instanceof Error` below misses these and every Supabase failure
// degrades to a stack-less `captureMessage` (SENTRY-7597067722).
type PostgrestErrorLike = {
  message: string;
  details?: string;
  hint?: string;
  code?: string;
};

function isPostgrestErrorLike(value: unknown): value is PostgrestErrorLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { message?: unknown }).message === "string" &&
    ("details" in value || "hint" in value || "code" in value)
  );
}

function forward(level: Sentry.SeverityLevel, message: string, args: unknown[]) {
  // Walk the args looking for the first Error (or Postgrest-error-shaped
  // object) — if present, capture it directly so Sentry uses the stack
  // trace/details. Otherwise capture the message string.
  for (const arg of args) {
    if (arg instanceof Error) {
      Sentry.captureException(arg, { level, extra: { message, args } });
      return;
    }
    if (isPostgrestErrorLike(arg)) {
      const error = new Error(arg.message);
      error.name = "PostgrestError";
      if (arg.details) error.stack = arg.details;
      Sentry.captureException(error, {
        level,
        extra: { message, args, code: arg.code, hint: arg.hint, details: arg.details },
      });
      return;
    }
  }
  Sentry.captureMessage(message, { level, extra: args.length ? { args } : undefined });
}

export const log = {
  error: (message: string, ...args: unknown[]) => {
    // eslint-disable-next-line no-console
    console.error(message, ...args);
    try {
      forward("error", message, args);
    } catch {
      // never let telemetry forwarding break the call site
    }
  },
  warn: (message: string, ...args: unknown[]) => {
    // eslint-disable-next-line no-console
    console.warn(message, ...args);
    try {
      forward("warning", message, args);
    } catch {
      // never let telemetry forwarding break the call site
    }
  },
  // eslint-disable-next-line no-console
  info: (message: string, ...args: unknown[]) => console.info(message, ...args),
  // eslint-disable-next-line no-console
  debug: (message: string, ...args: unknown[]) => console.debug(message, ...args),
};
