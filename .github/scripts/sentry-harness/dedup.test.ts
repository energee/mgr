import { describe, expect, it } from "vitest";
import { extractIssueIdFromBranch, filterClaimedIssues } from "./dedup";
import type { SentryIssue } from "./types";

function makeIssue(issueId: string): SentryIssue {
  return {
    issueId,
    shortId: `MGR-${issueId}`,
    title: "x",
    culprit: "x",
    permalink: "x",
    stackTrace: "",
    eventCount7d: 1,
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
