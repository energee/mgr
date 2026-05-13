/**
 * Structured Production Logger (pino)
 *
 * Configured pino instance for server-side structured logging in API routes
 * and server components.
 *
 * - In production: JSON output (pino default) for machine parsing by log
 *   aggregators (Datadog, CloudWatch, etc.)
 * - In development: JSON output (pino default); install pino-pretty and set
 *   LOG_LEVEL=debug for human-readable output if desired.
 * - Log level controlled by LOG_LEVEL env var, defaulting to "info" in
 *   production and "debug" in development.
 * - Error / fatal logs are also forwarded to Sentry (audit finding F-147)
 *   so on-call sees real production errors instead of only uncaught throws.
 *
 * Usage:
 *   import { logger } from "@/lib/logger";
 *   const log = logger.child({ route: "/api/chat" });
 *   log.info({ userId, action: "chat_request" }, "Chat request started");
 *   log.error({ err }, "Chat request failed"); // forwarded to Sentry
 */

import * as Sentry from "@sentry/nextjs";
import pino from "pino";

export type Logger = pino.Logger;

/** Pino numeric level for "error". */
const PINO_ERROR = 50;
/** Pino numeric level for "fatal". */
const PINO_FATAL = 60;

/**
 * Forward a pino log call to Sentry. Mirrors pino's flexible call shapes:
 *   logger.error(err)
 *   logger.error({ err, ...ctx }, "message")
 *   logger.error({ ...ctx }, "message")
 *   logger.error("message")
 *
 * Best-effort — wrapped in a try/catch by the caller so a Sentry failure
 * can never break the logger pipeline.
 *
 * NOTE: The context object is forwarded verbatim to Sentry's `extra` field.
 * Do not include raw PII (userId, email, tokens, etc.) in log context objects.
 */
function forwardToSentry(args: readonly unknown[], level: number): void {
  const sentryLevel: Sentry.SeverityLevel =
    level >= PINO_FATAL ? "fatal" : "error";
  const [first, second] = args;

  if (first instanceof Error) {
    Sentry.captureException(first, { level: sentryLevel });
    return;
  }
  if (first && typeof first === "object") {
    const obj = first as Record<string, unknown>;
    // Note: non-native Error-likes (e.g. custom hierarchies, cross-realm throws) fail instanceof
    const err = obj.err instanceof Error ? (obj.err as Error) : undefined;
    if (err) {
      const { err: _err, ...extra } = obj;
      Sentry.captureException(err, { level: sentryLevel, extra });
      return;
    }
    const message = typeof second === "string" ? second : "(no message)";
    Sentry.captureMessage(message, { level: sentryLevel, extra: obj });
    return;
  }
  if (typeof first === "string") {
    Sentry.captureMessage(first, { level: sentryLevel });
  }
}

export const logger = pino({
  level:
    process.env.LOG_LEVEL ||
    (process.env.NODE_ENV === "production" ? "info" : "debug"),
  hooks: {
    logMethod(inputArgs, method, level) {
      if (level >= PINO_ERROR) {
        try {
          forwardToSentry(inputArgs as unknown[], level);
        } catch {
          // never let Sentry forwarding break logging
        }
      }
      return method.apply(
        this,
        inputArgs as Parameters<pino.LogFn>,
      );
    },
  },
});
