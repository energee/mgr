/** One Sentry issue after normalization, with optional stack trace and score. */
export type SentryIssue = {
  issueId: string;
  shortId: string;
  title: string;
  culprit: string;
  permalink: string;
  stackTrace: string;
  eventCount7d: number;
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
