/**
 * Structured Logger
 *
 * Lightweight structured logging for server-side code (API routes, server components).
 * - In production: emits JSON-formatted log lines for machine parsing
 * - In development: uses console methods with human-readable formatting
 *
 * This avoids pino's bundling issues with Next.js Edge runtime and client bundles
 * while still providing structured, leveled logging.
 *
 * Usage:
 *   import { logger } from "@/lib/logger";
 *   logger.info("Request started", { route: "/api/chat", userId: "..." });
 *   logger.error("Database unreachable", { service: "postgres" });
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** Resolve the minimum log level from environment. Defaults to "debug" in dev, "info" in prod. */
function getMinLevel(): number {
  const envLevel = process.env.LOG_LEVEL as LogLevel | undefined;
  if (envLevel && envLevel in LOG_LEVELS) {
    return LOG_LEVELS[envLevel];
  }
  return process.env.NODE_ENV === "production" ? LOG_LEVELS.info : LOG_LEVELS.debug;
}

const isProduction = process.env.NODE_ENV === "production";
const minLevel = getMinLevel();

interface LogEntry {
  level: LogLevel;
  msg: string;
  time: string;
  [key: string]: unknown;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= minLevel;
}

function formatDev(entry: LogEntry): string {
  const { level, msg, time, ...rest } = entry;
  const extras = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : "";
  return `[${time}] ${level.toUpperCase().padEnd(5)} ${msg}${extras}`;
}

function log(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    level,
    msg,
    time: new Date().toISOString(),
    ...data,
  };

  if (isProduction) {
    // Structured JSON for log aggregators (Datadog, CloudWatch, etc.)
    const consoleMethod = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    consoleMethod(JSON.stringify(entry));
  } else {
    // Human-readable in development
    const formatted = formatDev(entry);
    switch (level) {
      case "error":
        console.error(formatted);
        break;
      case "warn":
        console.warn(formatted);
        break;
      case "debug":
        console.debug(formatted);
        break;
      default:
        console.log(formatted);
    }
  }
}

/**
 * Create a child logger with default fields merged into every log call.
 * Useful for tagging all logs from a specific module or request.
 */
function child(defaults: Record<string, unknown>) {
  return {
    debug: (msg: string, data?: Record<string, unknown>) =>
      log("debug", msg, { ...defaults, ...data }),
    info: (msg: string, data?: Record<string, unknown>) =>
      log("info", msg, { ...defaults, ...data }),
    warn: (msg: string, data?: Record<string, unknown>) =>
      log("warn", msg, { ...defaults, ...data }),
    error: (msg: string, data?: Record<string, unknown>) =>
      log("error", msg, { ...defaults, ...data }),
    child: (extraDefaults: Record<string, unknown>) =>
      child({ ...defaults, ...extraDefaults }),
  };
}

export const logger = {
  debug: (msg: string, data?: Record<string, unknown>) => log("debug", msg, data),
  info: (msg: string, data?: Record<string, unknown>) => log("info", msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => log("warn", msg, data),
  error: (msg: string, data?: Record<string, unknown>) => log("error", msg, data),
  /** Create a child logger with default fields merged into every log call. */
  child,
};
