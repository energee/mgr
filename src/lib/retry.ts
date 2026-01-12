/**
 * Retry Utility with Exponential Backoff
 *
 * Provides retry functionality for async operations that may fail transiently,
 * such as database operations during high load or network issues.
 */

// =============================================================================
// Types
// =============================================================================

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in milliseconds (default: 1000) */
  initialDelayMs?: number;
  /** Maximum delay in milliseconds (default: 10000) */
  maxDelayMs?: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** Function to determine if error is retryable (default: all errors) */
  isRetryable?: (error: unknown) => boolean;
  /** Callback called on each retry attempt */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attempts: number;
}

// =============================================================================
// Default Retry Configuration
// =============================================================================

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, "onRetry" | "isRetryable">> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
};

// =============================================================================
// Retry Functions
// =============================================================================

/**
 * Execute an async function with retry and exponential backoff.
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => supabase.from('batches').select('*'),
 *   { maxRetries: 3 }
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = DEFAULT_OPTIONS.maxRetries,
    initialDelayMs = DEFAULT_OPTIONS.initialDelayMs,
    maxDelayMs = DEFAULT_OPTIONS.maxDelayMs,
    backoffMultiplier = DEFAULT_OPTIONS.backoffMultiplier,
    isRetryable = () => true,
    onRetry,
  } = options;

  let lastError: Error | undefined;
  let delayMs = initialDelayMs;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if this is the last attempt or error is not retryable
      if (attempt > maxRetries || !isRetryable(error)) {
        throw lastError;
      }

      // Call onRetry callback
      onRetry?.(attempt, error, delayMs);

      // Wait with exponential backoff
      await sleep(delayMs);

      // Calculate next delay with exponential backoff
      delayMs = Math.min(delayMs * backoffMultiplier, maxDelayMs);
    }
  }

  // Should never reach here, but TypeScript needs this
  throw lastError || new Error("Retry failed");
}

/**
 * Execute an async function with retry, returning a result object instead of throwing.
 *
 * @example
 * ```typescript
 * const { success, data, error, attempts } = await withRetryResult(
 *   () => supabase.from('batches').select('*')
 * );
 * if (!success) {
 *   console.error(`Failed after ${attempts} attempts:`, error);
 * }
 * ```
 */
export async function withRetryResult<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<RetryResult<T>> {
  const {
    maxRetries = DEFAULT_OPTIONS.maxRetries,
    initialDelayMs = DEFAULT_OPTIONS.initialDelayMs,
    maxDelayMs = DEFAULT_OPTIONS.maxDelayMs,
    backoffMultiplier = DEFAULT_OPTIONS.backoffMultiplier,
    isRetryable = () => true,
    onRetry,
  } = options;

  let lastError: Error | undefined;
  let delayMs = initialDelayMs;
  let attempts = 0;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    attempts = attempt;
    try {
      const data = await fn();
      return { success: true, data, attempts };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if this is the last attempt or error is not retryable
      if (attempt > maxRetries || !isRetryable(error)) {
        return { success: false, error: lastError, attempts };
      }

      // Call onRetry callback
      onRetry?.(attempt, error, delayMs);

      // Wait with exponential backoff
      await sleep(delayMs);

      // Calculate next delay with exponential backoff
      delayMs = Math.min(delayMs * backoffMultiplier, maxDelayMs);
    }
  }

  return { success: false, error: lastError, attempts };
}

// =============================================================================
// Retry Predicate Helpers
// =============================================================================

/**
 * Create a retryable predicate for transient database errors.
 * These errors indicate temporary issues that may resolve on retry.
 */
export function isTransientDatabaseError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  // Check for Postgrest error codes
  const pgError = error as { code?: string; message?: string };

  // Transient error codes
  const transientCodes = [
    "40001", // Serialization failure
    "40P01", // Deadlock detected
    "53000", // Insufficient resources
    "53100", // Disk full
    "53200", // Out of memory
    "53300", // Too many connections
    "57014", // Query cancelled
    "08000", // Connection exception
    "08003", // Connection does not exist
    "08006", // Connection failure
  ];

  if (pgError.code && transientCodes.includes(pgError.code)) {
    return true;
  }

  // Check for network errors
  if (pgError.message) {
    const networkPatterns = [
      /network/i,
      /timeout/i,
      /ECONNREFUSED/i,
      /ECONNRESET/i,
      /ETIMEDOUT/i,
      /socket hang up/i,
      /connection.*closed/i,
    ];

    return networkPatterns.some((pattern) => pattern.test(pgError.message || ""));
  }

  return false;
}

/**
 * Create a retryable predicate that excludes certain error types.
 */
export function excludeErrors(...errorCodes: string[]): (error: unknown) => boolean {
  return (error: unknown) => {
    if (!error || typeof error !== "object") return true;
    const pgError = error as { code?: string };
    return !pgError.code || !errorCodes.includes(pgError.code);
  };
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Sleep for a specified number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Add jitter to a delay to prevent thundering herd.
 */
export function addJitter(delayMs: number, jitterFactor: number = 0.1): number {
  const jitter = delayMs * jitterFactor * Math.random();
  return Math.round(delayMs + jitter);
}
