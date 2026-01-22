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

  /** Dynamic data that changes moderately - lists, counts (1 minute) */
  DYNAMIC_DATA: 60 * 1000,

  /** User preferences - personal settings (5 minutes) */
  USER_PREFERENCES: 5 * 60 * 1000,

  /** Real-time data - notifications, active operations (10 seconds) */
  REALTIME_DATA: 10 * 1000,

  /** Long-lived data - system settings, enum values (10 minutes) */
  LONG_LIVED: 10 * 60 * 1000,
} as const;

// =============================================================================
// Pagination
// =============================================================================

export const PAGINATION = {
  /** Default page size for lists */
  DEFAULT_PAGE_SIZE: 25,

  /** Maximum page size allowed */
  MAX_PAGE_SIZE: 100,

  /** Page size options for selectors */
  PAGE_SIZE_OPTIONS: [10, 25, 50, 100] as const,
} as const;

// =============================================================================
// Query Limits
// =============================================================================

export const QUERY_LIMITS = {
  /** Default limit for relation queries */
  RELATION_DEFAULT: 50,

  /** Maximum records for dropdown searches */
  DROPDOWN_MAX: 100,

  /** Maximum records for autocomplete */
  AUTOCOMPLETE_MAX: 20,

  /** Batch log entries to load */
  BATCH_LOGS: 100,
} as const;

// =============================================================================
// UI Timeouts
// =============================================================================

export const TIMEOUTS = {
  /** Debounce delay for search inputs (ms) */
  SEARCH_DEBOUNCE: 300,

  /** Delay before showing loading indicators (ms) */
  LOADING_DELAY: 200,

  /** Toast notification duration (ms) */
  TOAST_DURATION: 5000,

  /** Auto-save interval (ms) */
  AUTO_SAVE_INTERVAL: 30 * 1000,
} as const;
