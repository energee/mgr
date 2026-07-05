import type { SentryIssue } from "./types";

const FREQUENCY_WEIGHT = 0.6;
const RECENCY_WEIGHT = 0.4;
const RECENCY_HALF_LIFE_HOURS = 24;
const SEVERITY_TIEBREAK_THRESHOLD = 0.05;

const SEVERITY_RANK: Record<SentryIssue["level"], number> = {
  fatal: 5,
  error: 4,
  warning: 3,
  info: 2,
  debug: 1,
};

/** Calculate recency score using half-life decay. Score ranges 0-1, with 1 being now. */
export function recencyScore(lastSeenIso: string, now: Date = new Date()): number {
  const diffMs = now.getTime() - new Date(lastSeenIso).getTime();
  if (diffMs <= 0) return 1.0;
  const hours = diffMs / (1000 * 60 * 60);
  return Math.pow(0.5, hours / RECENCY_HALF_LIFE_HOURS);
}

/** Normalize event counts 0-1 by dividing each by the max in the batch. */
export function normalizeFrequencies(issues: SentryIssue[]): Map<string, number> {
  const result = new Map<string, number>();
  if (issues.length === 0) return result;
  const max = Math.max(...issues.map((i) => i.eventCount14d));
  for (const issue of issues) {
    result.set(issue.issueId, max === 0 ? 0 : issue.eventCount14d / max);
  }
  return result;
}

/** Score issues using: (normalized_frequency × 0.6) + (recency_score × 0.4). */
export function scoreIssues(
  issues: SentryIssue[],
  now: Date = new Date(),
): (SentryIssue & { score: number })[] {
  const frequencies = normalizeFrequencies(issues);
  return issues.map((issue) => {
    const freq = frequencies.get(issue.issueId) ?? 0;
    const recency = recencyScore(issue.lastSeen, now);
    const score = freq * FREQUENCY_WEIGHT + recency * RECENCY_WEIGHT;
    return { ...issue, score };
  });
}

/** Sort by score descending, breaking ties within 0.05 by severity. */
export function sortByScore<T extends SentryIssue & { score: number }>(issues: T[]): T[] {
  return [...issues].sort((a, b) => {
    const gap = Math.abs(a.score - b.score);
    if (gap <= SEVERITY_TIEBREAK_THRESHOLD) {
      const rankDiff = SEVERITY_RANK[b.level] - SEVERITY_RANK[a.level];
      if (rankDiff !== 0) return rankDiff;
    }
    return b.score - a.score;
  });
}
