/**
 * Client-safe Logger
 *
 * Lightweight logger for browser-bundled code that wraps console methods
 * with a consistent API. Use this in client components and shared lib files.
 *
 * For server-only code (API routes), use `import { logger } from "@/lib/logger"`
 * which provides structured pino logging.
 */

export const log = {
  error: (message: string, ...args: unknown[]) => console.error(message, ...args),
  warn: (message: string, ...args: unknown[]) => console.warn(message, ...args),
  info: (message: string, ...args: unknown[]) => console.info(message, ...args),
  debug: (message: string, ...args: unknown[]) => console.debug(message, ...args),
};
