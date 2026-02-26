/**
 * In-memory sliding window rate limiter for API routes.
 *
 * Uses identifier-based tracking (typically IP address) with configurable
 * window duration and request limits. Expired entries are automatically
 * cleaned up every 5 minutes to prevent memory leaks.
 *
 * Usage:
 *   const ip = getClientIp(request);
 *   const result = rateLimit(`chat:${ip}`, { windowMs: 60_000, maxRequests: 10 });
 *   if (!result.success) {
 *     return Response.json({ error: "Too many requests" }, { status: 429 });
 *   }
 */

interface RateLimitConfig {
  /** Duration of the sliding window in milliseconds. Defaults to 60000 (1 minute). */
  windowMs?: number;
  /** Maximum number of requests allowed within the window. Defaults to 10. */
  maxRequests?: number;
}

interface RateLimitResult {
  /** Whether the request is allowed. */
  success: boolean;
  /** Number of remaining requests in the current window. */
  remaining: number;
  /** Milliseconds until the earliest request in the window expires. */
  resetMs: number;
}

/** Map of identifier -> array of request timestamps (epoch ms). */
const requestMap = new Map<string, number[]>();

/** Timestamp of the last cleanup run. */
let lastCleanup = Date.now();

/** Interval between automatic cleanup sweeps (5 minutes). */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Remove expired entries from the request map to prevent unbounded memory growth.
 * Called automatically on each `rateLimit` invocation if enough time has elapsed.
 */
function cleanup(windowMs: number): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;

  lastCleanup = now;
  for (const [key, timestamps] of requestMap) {
    const valid = timestamps.filter((t) => now - t < windowMs);
    if (valid.length === 0) {
      requestMap.delete(key);
    } else {
      requestMap.set(key, valid);
    }
  }
}

/**
 * Check and record a rate-limited request.
 *
 * @param identifier - Unique key for the rate limit bucket (e.g. "chat:192.168.1.1").
 * @param config - Optional window duration and max request count overrides.
 * @returns Result indicating whether the request is allowed, remaining quota, and reset time.
 */
export function rateLimit(
  identifier: string,
  config?: RateLimitConfig,
): RateLimitResult {
  const windowMs = config?.windowMs ?? 60_000;
  const maxRequests = config?.maxRequests ?? 10;
  const now = Date.now();

  // Opportunistic cleanup of stale entries
  cleanup(windowMs);

  // Get existing timestamps and filter to the current window
  const timestamps = (requestMap.get(identifier) ?? []).filter(
    (t) => now - t < windowMs,
  );

  if (timestamps.length >= maxRequests) {
    // Rate limited — compute when the earliest request expires
    const oldestInWindow = timestamps[0];
    const resetMs = oldestInWindow + windowMs - now;
    requestMap.set(identifier, timestamps);
    return {
      success: false,
      remaining: 0,
      resetMs,
    };
  }

  // Allow the request and record its timestamp
  timestamps.push(now);
  requestMap.set(identifier, timestamps);

  return {
    success: true,
    remaining: maxRequests - timestamps.length,
    resetMs: timestamps[0] + windowMs - now,
  };
}

/**
 * Extract the client IP address from request headers.
 *
 * Checks common proxy headers in order of precedence:
 * 1. `x-forwarded-for` (first entry, set by most reverse proxies)
 * 2. `x-real-ip` (set by Nginx and some CDNs)
 * 3. Falls back to "unknown" if no IP can be determined.
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    // x-forwarded-for may contain a comma-separated list; use the first (client) IP
    return forwarded.split(",")[0].trim();
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }

  return "unknown";
}
