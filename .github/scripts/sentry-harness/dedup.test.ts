import { describe, expect, it } from "vitest";
import {
  extractIssueIdFromBranch,
  filterClaimedIssues,
  filterFixedIssues,
  filterTriagedIssues,
  isWorktreeArtifact,
} from "./dedup";
import type { SentryIssue } from "./types";

function makeIssue(issueId: string): SentryIssue {
  return {
    issueId,
    shortId: `MGR-${issueId}`,
    title: "x",
    culprit: "x",
    permalink: "x",
    stackTrace: "",
    eventCount14d: 1,
    firstSeen: "2026-04-09T00:00:00Z",
    lastSeen: "2026-04-16T00:00:00Z",
    level: "error",
    environment: "development",
    tags: {},
  };
}

describe("extractIssueIdFromBranch", () => {
  it("extracts numeric id from valid branch name", () => {
    expect(extractIssueIdFromBranch("sentry-fix/SENTRY-12345")).toBe("12345");
  });

  it("returns null for non-matching branch", () => {
    expect(extractIssueIdFromBranch("feat/other-work")).toBeNull();
  });

  it("returns null for branch without numeric id", () => {
    expect(extractIssueIdFromBranch("sentry-fix/SENTRY-abc")).toBeNull();
  });

  it("returns null for branch with extra segments", () => {
    expect(extractIssueIdFromBranch("sentry-fix/SENTRY-123/extra")).toBeNull();
  });
});

describe("filterClaimedIssues", () => {
  it("removes issues whose id appears in open branch names", () => {
    const issues = [makeIssue("1"), makeIssue("2"), makeIssue("3")];
    const openBranches = ["sentry-fix/SENTRY-2", "main", "feat/other"];
    const filtered = filterClaimedIssues(issues, openBranches);
    expect(filtered.map((i) => i.issueId)).toEqual(["1", "3"]);
  });

  it("returns all issues when no branches are claimed", () => {
    const issues = [makeIssue("1"), makeIssue("2")];
    const filtered = filterClaimedIssues(issues, []);
    expect(filtered.map((i) => i.issueId)).toEqual(["1", "2"]);
  });

  it("ignores non-sentry-fix branches entirely", () => {
    const issues = [makeIssue("1")];
    const filtered = filterClaimedIssues(issues, ["feat/foo", "fix/bar"]);
    expect(filtered.map((i) => i.issueId)).toEqual(["1"]);
  });
});

describe("filterFixedIssues", () => {
  // makeIssue sets lastSeen to 2026-04-16T00:00:00Z.
  const mergedBefore = { headRefName: "sentry-fix/SENTRY-1", mergedAt: "2026-04-10T00:00:00Z" };
  const mergedAfter = { headRefName: "sentry-fix/SENTRY-1", mergedAt: "2026-04-20T00:00:00Z" };

  it("drops issues with no events since the fix merged", () => {
    const filtered = filterFixedIssues([makeIssue("1"), makeIssue("2")], [mergedAfter]);
    expect(filtered.map((i) => i.issueId)).toEqual(["2"]);
  });

  it("keeps issues that recurred after the fix merged", () => {
    const filtered = filterFixedIssues([makeIssue("1")], [mergedBefore]);
    expect(filtered.map((i) => i.issueId)).toEqual(["1"]);
  });

  it("uses the latest merge when an issue has several merged PRs", () => {
    const filtered = filterFixedIssues([makeIssue("1")], [mergedBefore, mergedAfter]);
    expect(filtered).toEqual([]);
  });

  it("ignores merged PRs from non-sentry-fix branches and bad dates", () => {
    const filtered = filterFixedIssues(
      [makeIssue("1")],
      [
        { headRefName: "feat/foo", mergedAt: "2026-04-20T00:00:00Z" },
        { headRefName: "sentry-fix/SENTRY-1", mergedAt: "not-a-date" },
      ],
    );
    expect(filtered.map((i) => i.issueId)).toEqual(["1"]);
  });
});

describe("filterTriagedIssues", () => {
  // makeIssue("1") has shortId MGR-1 and lastSeen 2026-04-16T00:00:00Z.
  it("drops issues with an open triage issue", () => {
    const filtered = filterTriagedIssues(
      [makeIssue("1"), makeIssue("2")],
      [{ title: "[sentry] MGR-1: dev artifact", state: "OPEN", closedAt: null }],
    );
    expect(filtered.map((i) => i.issueId)).toEqual(["2"]);
  });

  it("drops issues whose triage issue closed after the last event", () => {
    const filtered = filterTriagedIssues(
      [makeIssue("1")],
      [{ title: "[sentry] MGR-1: stale route", state: "CLOSED", closedAt: "2026-04-20T00:00:00Z" }],
    );
    expect(filtered).toEqual([]);
  });

  it("keeps issues that recurred after their triage issue was closed", () => {
    const filtered = filterTriagedIssues(
      [makeIssue("1")],
      [{ title: "[sentry] MGR-1: stale route", state: "CLOSED", closedAt: "2026-04-10T00:00:00Z" }],
    );
    expect(filtered.map((i) => i.issueId)).toEqual(["1"]);
  });

  it("uses the latest closure when several triage issues exist", () => {
    const filtered = filterTriagedIssues(
      [makeIssue("1")],
      [
        { title: "[sentry] MGR-1: first triage", state: "CLOSED", closedAt: "2026-04-10T00:00:00Z" },
        { title: "[sentry] MGR-1: second triage", state: "CLOSED", closedAt: "2026-04-20T00:00:00Z" },
      ],
    );
    expect(filtered).toEqual([]);
  });

  it("ignores non-sentry titles, other shortIds, and bad dates", () => {
    const filtered = filterTriagedIssues(
      [makeIssue("1")],
      [
        { title: "fix: unrelated bug", state: "OPEN", closedAt: null },
        { title: "[sentry] MGR-9: other issue", state: "OPEN", closedAt: null },
        { title: "[sentry] MGR-1: bad date", state: "CLOSED", closedAt: "not-a-date" },
        { title: "[sentry] MGR-1: no date", state: "CLOSED", closedAt: null },
      ],
    );
    expect(filtered.map((i) => i.issueId)).toEqual(["1"]);
  });
});

describe("isWorktreeArtifact", () => {
  it("detects worktree chunk paths in the stack trace", () => {
    const issue = {
      ...makeIssue("1"),
      stackTrace:
        "at x (app:///_next/static/chunks/_agents_worktrees_mgr_ux-improvements_src_8dd5dab1._.js:1:1)",
    };
    expect(isWorktreeArtifact(issue)).toBe(true);
  });

  it("detects legacy claude worktree chunk paths", () => {
    const issue = {
      ...makeIssue("1"),
      stackTrace: "chunks/_claude_worktrees_batch-loss_src_components_00179f9a._.js",
    };
    expect(isWorktreeArtifact(issue)).toBe(true);
  });

  it("detects worktree paths embedded in the title (compile errors)", () => {
    const issue = {
      ...makeIssue("1"),
      title: "Error: ./.agents/worktrees/mgr/ux-improvements/src/components/x.tsx:614:39",
    };
    expect(isWorktreeArtifact(issue)).toBe(true);
  });

  it("keeps ordinary issues", () => {
    const issue = {
      ...makeIssue("1"),
      title: "TypeError: Failed to fetch",
      culprit: "/sales/customers/:id",
      stackTrace: "at fetchNotifications (app:///_next/static/chunks/src_lib_abc._.js:10:5)",
    };
    expect(isWorktreeArtifact(issue)).toBe(false);
  });
});
