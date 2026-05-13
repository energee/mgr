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

function forward(level: Sentry.SeverityLevel, message: string, args: unknown[]) {
  // Walk the args looking for the first Error — if present, capture it directly
  // so Sentry uses the stack trace. Otherwise capture the message string.
  for (const arg of args) {
    if (arg instanceof Error) {
      Sentry.captureException(arg, { level, extra: { message, args } });
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
