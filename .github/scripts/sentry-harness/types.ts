/** One Sentry issue after normalization, with optional stack trace and score. */
export type SentryIssue = {
  issueId: string;
  shortId: string;
  title: string;
  culprit: string;
  permalink: string;
  stackTrace: string;
  /**
   * Flattened dump of the latest event's `contexts` + `extra` bag and its
   * `message`/`request` entries. This is where a Supabase failure carries its
   * real cause — the PostgrestError `code` (42501 = permission denied,
   * 42883 = undefined function), `details`, and `hint`. Without it, a
   * `log.error("Failed to fetch X:", err)` issue presents as nothing but a
   * stack trace ending in the error handler, and the only fix reachable from
   * the repo is the error handler itself.
   */
  eventContext: string;
  /** Most recent breadcrumbs (newest last), formatted one per line. */
  breadcrumbs: string;
  eventCount14d: number;
  firstSeen: string;
  lastSeen: string;
  level: "fatal" | "error" | "warning" | "info" | "debug";
  environment: string;
  tags: Record<string, string>;
};

/** SentryIssue with score and prompt attached — the harness's final output per error. */
export type ScoredIssue = SentryIssue & {
  score: number;
  prompt: string;
};

/** Options for fetching from the Sentry API. */
export type SentryFetchOptions = {
  org: string;
  project: string;
  authToken: string;
  environment?: string;
  statsPeriod?: string;
  limit?: number;
};
