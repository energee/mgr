/**
 * Sentry API client for the error harness.
 *
 * Split into pure functions (URL building, response normalization, stack trace /
 * context / breadcrumb formatting) plus one thin fetch wrapper
 * (`fetchIssuesWithStacks`).
 *
 * Makes N+1 API calls intentionally: one for the issues list, then one per
 * issue to retrieve its latest event — which carries the stack trace, the
 * contexts/extra bags, and the breadcrumb trail.
 */

import type { SentryFetchOptions, SentryIssue } from "./types";

const SENTRY_BASE = "https://sentry.io";

type RawIssue = {
  id: string;
  shortId: string;
  title: string;
  culprit: string;
  permalink: string;
  count: string;
  firstSeen: string;
  lastSeen: string;
  level: string;
};

type RawTag = { key: string; value: string };

type RawFrame = { filename?: string; lineNo?: number; function?: string };

type RawBreadcrumb = {
  timestamp?: string;
  category?: string;
  level?: string;
  message?: string;
};

type RawEvent = {
  tags?: RawTag[];
  message?: string;
  // Sentry's event JSON carries structured context under `contexts` and the
  // free-form "additional data" bag under `context`. Both are untyped by
  // design — callers dump them verbatim rather than parse them.
  contexts?: Record<string, unknown>;
  context?: Record<string, unknown>;
  entries?: Array<{
    type: string;
    data?: {
      values?: Array<{
        type?: string;
        value?: string;
        stacktrace?: { frames?: RawFrame[] };
      }>;
      // entries[type=breadcrumbs].data.values
      [key: string]: unknown;
    };
  }>;
};

/** Max breadcrumbs to carry into the prompt. Newest are the diagnostic ones. */
const BREADCRUMB_LIMIT = 20;
/** Cap on any single serialized context value, to keep the prompt bounded. */
const CONTEXT_VALUE_MAX_CHARS = 1000;

const VALID_LEVELS: SentryIssue["level"][] = ["fatal", "error", "warning", "info", "debug"];

/** Builds the Sentry issues list URL for a given org/project with optional filters. */
export function buildIssuesUrl(opts: {
  org: string;
  project: string;
  environment?: string;
  statsPeriod?: string;
  limit?: number;
}): string {
  const query = opts.environment
    ? `is:unresolved environment:${opts.environment}`
    : "is:unresolved";
  const params = new URLSearchParams({
    query,
    // Default matches the `eventCount14d` field on SentryIssue; callers can
    // override. Sentry's project issues endpoint only accepts '', '24h', and
    // '14d' — '7d' started returning 400s in June 2026.
    statsPeriod: opts.statsPeriod ?? "14d",
    limit: String(opts.limit ?? 20),
    sort: "freq",
  });
  return `${SENTRY_BASE}/api/0/projects/${opts.org}/${opts.project}/issues/?${params.toString()}`;
}

/** Builds the URL for an issue's latest event (used to retrieve stack traces). */
export function buildLatestEventUrl(issueId: string): string {
  return `${SENTRY_BASE}/api/0/issues/${issueId}/events/latest/`;
}

/**
 * Extracts and formats a human-readable stack trace from a Sentry event object.
 * Returns an empty string when no exception entry is present.
 */
export function formatStackTrace(event: RawEvent): string {
  const exceptionEntry = event.entries?.find((e) => e.type === "exception");
  const values = exceptionEntry?.data?.values ?? [];
  if (values.length === 0) return "";

  const parts: string[] = [];
  for (const v of values) {
    parts.push(`${v.type ?? "Error"}: ${v.value ?? ""}`);
    const frames = v.stacktrace?.frames ?? [];
    // Sentry stores frames innermost-last; reverse so innermost appears first.
    for (const frame of frames.slice().reverse()) {
      const fn = frame.function ?? "<anonymous>";
      const file = frame.filename ?? "<unknown>";
      const line = frame.lineNo ?? 0;
      parts.push(`  at ${fn} (${file}:${line})`);
    }
  }
  return parts.join("\n");
}

function serialize(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return "";
  return text.length > CONTEXT_VALUE_MAX_CHARS
    ? `${text.slice(0, CONTEXT_VALUE_MAX_CHARS)}… (truncated)`
    : text;
}

/**
 * Flattens the diagnostically useful, non-stack parts of an event: the message,
 * the request line, and every key of the `contexts` / `context` (extra) bags.
 *
 * For a Supabase RPC failure logged via `log.error(msg, err)`, the
 * PostgrestError's `code`/`details`/`hint` land in one of these bags — they are
 * the difference between "the RPC is missing a GRANT" and a bare "Failed to
 * fetch". Returns "" when the event carries no context at all.
 */
export function formatEventContext(event: RawEvent): string {
  const lines: string[] = [];

  if (event.message) lines.push(`message: ${serialize(event.message)}`);

  const request = event.entries?.find((e) => e.type === "request")?.data as
    | { url?: string; method?: string }
    | undefined;
  if (request?.url) {
    lines.push(`request: ${request.method ?? "GET"} ${serialize(request.url)}`);
  }

  for (const [bagName, bag] of [
    ["contexts", event.contexts],
    ["extra", event.context],
  ] as const) {
    for (const [key, value] of Object.entries(bag ?? {})) {
      // Sentry injects these into every event; they carry no signal about the
      // failure itself and would crowd out the bags that do.
      if (bagName === "contexts" && (key === "trace" || key === "runtime")) continue;
      const text = serialize(value);
      if (text) lines.push(`${bagName}.${key}: ${text}`);
    }
  }

  return lines.join("\n");
}

/** Formats an event's breadcrumb trail, oldest first, capped at BREADCRUMB_LIMIT. */
export function formatBreadcrumbs(event: RawEvent): string {
  const entry = event.entries?.find((e) => e.type === "breadcrumbs");
  const values = (entry?.data?.values as RawBreadcrumb[] | undefined) ?? [];
  return values
    .slice(-BREADCRUMB_LIMIT)
    .map((b) => {
      const at = b.timestamp ?? "?";
      const level = b.level ?? "info";
      const category = b.category ?? "default";
      return `[${at}] ${level} ${category}: ${b.message ?? ""}`.trimEnd();
    })
    .join("\n");
}

/**
 * Normalizes a raw Sentry API issue + its tags, stack trace, and event context
 * into a typed `SentryIssue`. Unknown `level` values fall back to `"error"`.
 */
export function normalizeIssue(
  raw: RawIssue,
  tags: RawTag[],
  stackTrace: string,
  eventContext = "",
  breadcrumbs = "",
): SentryIssue {
  const tagMap: Record<string, string> = {};
  for (const tag of tags) tagMap[tag.key] = tag.value;

  const level = (VALID_LEVELS as string[]).includes(raw.level)
    ? (raw.level as SentryIssue["level"])
    : "error";

  return {
    issueId: raw.id,
    shortId: raw.shortId,
    title: raw.title,
    culprit: raw.culprit,
    permalink: raw.permalink,
    stackTrace,
    eventContext,
    breadcrumbs,
    eventCount14d: Number.parseInt(raw.count, 10) || 0,
    firstSeen: raw.firstSeen,
    lastSeen: raw.lastSeen,
    level,
    environment: tagMap.environment ?? "unknown",
    tags: tagMap,
  };
}

/** Performs an authenticated GET against the Sentry API. Throws on non-2xx. */
async function sentryGet<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Sentry API ${response.status}: ${body.slice(0, 500)}`);
  }
  return response.json() as Promise<T>;
}

/**
 * Fetches the top issues for an org/project from Sentry, then retrieves each
 * issue's latest event to attach a stack trace. Returns normalized `SentryIssue[]`.
 *
 * Makes N+1 requests intentionally — one list call plus one per issue.
 */
export async function fetchIssuesWithStacks(
  opts: SentryFetchOptions,
): Promise<SentryIssue[]> {
  const issuesUrl = buildIssuesUrl(opts);
  const rawIssues = await sentryGet<RawIssue[]>(issuesUrl, opts.authToken);

  const results: SentryIssue[] = [];
  for (const raw of rawIssues) {
    const event = await sentryGet<RawEvent>(
      buildLatestEventUrl(raw.id),
      opts.authToken,
    );
    results.push(
      normalizeIssue(
        raw,
        event.tags ?? [],
        formatStackTrace(event),
        formatEventContext(event),
        formatBreadcrumbs(event),
      ),
    );
  }
  return results;
}
