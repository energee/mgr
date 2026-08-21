/**
 * Application Constants
 *
 * Centralized constants to avoid magic numbers and ensure consistency.
 */

// =============================================================================
// Cache Durations (in milliseconds)
// =============================================================================

export const CACHE_DURATIONS = {
  /** Static data that rarely changes - catalogs, options, settings (5 minutes) */
  STATIC_DATA: 5 * 60 * 1000,

  /** Dynamic data that changes moderately - lists, counts (2 minutes) */
  DYNAMIC_DATA: 2 * 60 * 1000,

  /** User preferences - personal settings (5 minutes) */
  USER_PREFERENCES: 5 * 60 * 1000,

  /** Real-time data - notifications, active operations (10 seconds) */
  REALTIME_DATA: 10 * 1000,

  /** Long-lived data - system settings, enum values (10 minutes) */
  LONG_LIVED: 10 * 60 * 1000,
} as const;

// =============================================================================
// Tables
// =============================================================================

/**
 * Default table page size. Lives here (server-safe module) so the client
 * pagination hook, the server list prefetch (defaultListParams), and route
 * loading skeletons all share one value.
 */
export const DEFAULT_PAGE_SIZE = 25;

// =============================================================================
// Polling Intervals (in milliseconds)
// =============================================================================

export const POLLING_INTERVALS = {
  /** Frequently-changing data like active batches and order counts (1 minute) */
  FAST: 60 * 1000,

  /** Moderately-changing data like vessel utilization and summaries (2 minutes) */
  NORMAL: 2 * 60 * 1000,
} as const;
