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
