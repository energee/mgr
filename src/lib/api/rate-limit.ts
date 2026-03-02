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

/** A rate limit bucket stores timestamps and the window duration configured for it. */
interface BucketEntry {
  timestamps: number[];
  windowMs: number;
}

/** Map of identifier -> bucket with request timestamps and associated window. */
const requestMap = new Map<string, BucketEntry>();

/** Timestamp of the last cleanup run. */
let lastCleanup = Date.now();

/** Interval between automatic cleanup sweeps (5 minutes). */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Remove expired entries from the request map to prevent unbounded memory growth.
 * Called automatically on each `rateLimit` invocation if enough time has elapsed.
 * Each bucket is cleaned using its own configured windowMs to avoid cross-bucket
 * interference when different callers use different window durations.
 */
function cleanup(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;

  lastCleanup = now;
  for (const [key, entry] of requestMap) {
    const valid = entry.timestamps.filter((t) => now - t < entry.windowMs);
    if (valid.length === 0) {
      requestMap.delete(key);
    } else {
      requestMap.set(key, { ...entry, timestamps: valid });
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
  cleanup();

  // Get existing timestamps and filter to the current window
  const existing = requestMap.get(identifier);
  const timestamps = (existing?.timestamps ?? []).filter(
    (t) => now - t < windowMs,
  );

  if (timestamps.length >= maxRequests) {
    // Rate limited — compute when the earliest request expires
    const oldestInWindow = timestamps[0];
    const resetMs = oldestInWindow + windowMs - now;
    requestMap.set(identifier, { timestamps, windowMs });
    return {
      success: false,
      remaining: 0,
      resetMs,
    };
  }

  // Allow the request and record its timestamp
  timestamps.push(now);
  requestMap.set(identifier, { timestamps, windowMs });

  return {
    success: true,
    remaining: maxRequests - timestamps.length,
    resetMs: timestamps[0] + windowMs - now,
  };
}

/**
 * Extract the client IP address from request headers.
 *
 * Checks proxy headers in order of trust:
 * 1. `x-real-ip` — set by the infrastructure (Vercel, Nginx) from the actual
 *    TCP connection and cannot be spoofed by clients.
 * 2. `x-forwarded-for` — can be spoofed by clients (they control the first
 *    entry), so only used as a fallback when `x-real-ip` is unavailable.
 * 3. Falls back to "unknown" if no IP can be determined.
 */
export function getClientIp(request: Request): string {
  // Prefer x-real-ip: set by the platform from the actual connection, not spoofable
  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }

  // Fallback to x-forwarded-for (last entry is most trustworthy, added by the
  // nearest proxy; earlier entries may be client-supplied)
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",");
    return parts[parts.length - 1].trim();
  }

  return "unknown";
}
