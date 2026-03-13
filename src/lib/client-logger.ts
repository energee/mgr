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
  // eslint-disable-next-line no-console
  error: (message: string, ...args: unknown[]) => console.error(message, ...args),
  // eslint-disable-next-line no-console
  warn: (message: string, ...args: unknown[]) => console.warn(message, ...args),
  // eslint-disable-next-line no-console
  info: (message: string, ...args: unknown[]) => console.info(message, ...args),
  // eslint-disable-next-line no-console
  debug: (message: string, ...args: unknown[]) => console.debug(message, ...args),
};
