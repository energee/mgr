import type { SentryIssue } from "./types";

const BRANCH_PATTERN = /^sentry-fix\/SENTRY-(\d+)$/;

export function extractIssueIdFromBranch(branchName: string): string | null {
  const match = branchName.match(BRANCH_PATTERN);
  return match ? match[1] : null;
}

export function filterClaimedIssues(
  issues: SentryIssue[],
  openBranches: string[],
): SentryIssue[] {
  const claimed = new Set<string>();
  for (const branch of openBranches) {
    const id = extractIssueIdFromBranch(branch);
    if (id) claimed.add(id);
  }
  return issues.filter((issue) => !claimed.has(issue.issueId));
}

/** A GitHub issue as returned by `gh issue list --json title,state,closedAt`. */
export type TriageIssue = { title: string; state: string; closedAt: string | null };

const TRIAGE_TITLE_PATTERN = /^\[sentry\] ([A-Za-z0-9-]+):/;

/**
 * Drops Sentry issues that a previous harness run already triaged into a
 * GitHub issue (title `[sentry] <shortId>: …`). Without this, a (B)/(C)
 * classification — which ends in an issue, not a PR — leaves the Sentry
 * issue unresolved, and every subsequent run re-triages it and files a
 * duplicate (MGR-H accumulated four issues this way; 16 of the 50 issues
 * open on 2026-07-16 were such duplicates). An open triage issue always
 * suppresses; a closed one suppresses unless the Sentry issue has had
 * events since it was closed (`lastSeen > closedAt`) — a recurrence after
 * closure deserves a fresh look.
 */
export function filterTriagedIssues(
  issues: SentryIssue[],
  triageIssues: TriageIssue[],
): SentryIssue[] {
  const openShortIds = new Set<string>();
  const latestClosedAt = new Map<string, number>();
  for (const triage of triageIssues) {
    const match = triage.title.match(TRIAGE_TITLE_PATTERN);
    if (!match) continue;
    const shortId = match[1];
    if (triage.state.toUpperCase() === "OPEN") {
      openShortIds.add(shortId);
      continue;
    }
    const closedAt = triage.closedAt ? new Date(triage.closedAt).getTime() : NaN;
    if (Number.isNaN(closedAt)) continue;
    const prev = latestClosedAt.get(shortId);
    if (prev === undefined || closedAt > prev) latestClosedAt.set(shortId, closedAt);
  }
  return issues.filter((issue) => {
    if (openShortIds.has(issue.shortId)) return false;
    const closedAt = latestClosedAt.get(issue.shortId);
    if (closedAt === undefined) return true;
    return new Date(issue.lastSeen).getTime() > closedAt;
  });
}

const WORKTREE_MARKERS = [
  "_agents_worktrees_", // Turbopack chunk path form
  "_claude_worktrees_", // legacy chunk path form
  ".agents/worktrees/",
  ".claude/worktrees/",
];

/**
 * True when the event demonstrably came from a build inside an agent
 * worktree rather than this checkout — dev-mode HMR/Fast-Refresh noise that
 * is never fixable from main (see issues #492/#509/#512). Detectable via
 * the worktree path segment Turbopack embeds in chunk paths (stack trace)
 * or, for compile errors, in the error message/title itself. Summaries have
 * no stack trace yet, so this runs both pre-scoring (title/culprit) and
 * post-enrichment (full stack).
 */
export function isWorktreeArtifact(
  issue: Pick<SentryIssue, "title" | "culprit" | "stackTrace">,
): boolean {
  const haystack = `${issue.title}\n${issue.culprit}\n${issue.stackTrace}`;
  return WORKTREE_MARKERS.some((marker) => haystack.includes(marker));
}

/** A merged sentry-fix PR, as returned by `gh pr list --json headRefName,mergedAt`. */
export type MergedFixPr = { headRefName: string; mergedAt: string };

/**
 * Drops issues that a merged sentry-fix PR appears to have already fixed:
 * the issue has had no Sentry events since the PR merged
 * (`lastSeen <= mergedAt`). Sentry keeps issues "unresolved" until someone
 * resolves them by hand, so without this filter a fixed-but-unresolved issue
 * is re-picked every run (MGR-4 accumulated five PRs this way). Issues that
 * recur after the merge stay eligible — the fix evidently didn't hold.
 */
export function filterFixedIssues(
  issues: SentryIssue[],
  mergedPrs: MergedFixPr[],
): SentryIssue[] {
  const latestMergeByIssue = new Map<string, number>();
  for (const pr of mergedPrs) {
    const id = extractIssueIdFromBranch(pr.headRefName);
    if (!id) continue;
    const mergedAt = new Date(pr.mergedAt).getTime();
    if (Number.isNaN(mergedAt)) continue;
    const prev = latestMergeByIssue.get(id);
    if (prev === undefined || mergedAt > prev) latestMergeByIssue.set(id, mergedAt);
  }
  return issues.filter((issue) => {
    const mergedAt = latestMergeByIssue.get(issue.issueId);
    if (mergedAt === undefined) return true;
    return new Date(issue.lastSeen).getTime() > mergedAt;
  });
}
