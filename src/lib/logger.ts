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

/** Resolve the appropriate console method for a given log level. */
function consoleMethodForLevel(level: LogLevel): (...args: unknown[]) => void {
  switch (level) {
    case "error":
      return console.error;
    case "warn":
      return console.warn;
    case "debug":
      return console.debug;
    default:
      return console.log;
  }
}

function log(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    level,
    msg,
    time: new Date().toISOString(),
    ...data,
  };

  const method = consoleMethodForLevel(level);

  if (isProduction) {
    // Structured JSON for log aggregators (Datadog, CloudWatch, etc.)
    method(JSON.stringify(entry));
  } else {
    // Human-readable in development
    method(formatDev(entry));
  }
}

/** Public interface for the logger and child loggers. */
export interface Logger {
  debug: (msg: string, data?: Record<string, unknown>) => void;
  info: (msg: string, data?: Record<string, unknown>) => void;
  warn: (msg: string, data?: Record<string, unknown>) => void;
  error: (msg: string, data?: Record<string, unknown>) => void;
  child: (defaults: Record<string, unknown>) => Logger;
}

/**
 * Create a child logger with default fields merged into every log call.
 * Useful for tagging all logs from a specific module or request.
 */
function child(defaults: Record<string, unknown>): Logger {
  return {
    debug: (msg, data) => log("debug", msg, { ...defaults, ...data }),
    info: (msg, data) => log("info", msg, { ...defaults, ...data }),
    warn: (msg, data) => log("warn", msg, { ...defaults, ...data }),
    error: (msg, data) => log("error", msg, { ...defaults, ...data }),
    child: (extraDefaults) => child({ ...defaults, ...extraDefaults }),
  };
}

export const logger: Logger = {
  debug: (msg, data) => log("debug", msg, data),
  info: (msg, data) => log("info", msg, data),
  warn: (msg, data) => log("warn", msg, data),
  error: (msg, data) => log("error", msg, data),
  child,
};
