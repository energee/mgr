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
