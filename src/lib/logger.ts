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
 *
 * Usage:
 *   import { logger } from "@/lib/logger";
 *   const log = logger.child({ route: "/api/chat" });
 *   log.info({ userId, action: "chat_request" }, "Chat request started");
 */

import pino from "pino";

export type Logger = pino.Logger;

export const logger = pino({
  level:
    process.env.LOG_LEVEL ||
    (process.env.NODE_ENV === "production" ? "info" : "debug"),
});
