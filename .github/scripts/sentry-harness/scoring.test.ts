import { describe, expect, it } from "vitest";
import { recencyScore, normalizeFrequencies, scoreIssues, sortByScore } from "./scoring";
import type { SentryIssue } from "./types";

const NOW = new Date("2026-04-16T14:00:00Z");

function makeIssue(partial: Partial<SentryIssue> & { issueId: string }): SentryIssue {
  return {
    issueId: partial.issueId,
    shortId: partial.shortId ?? `MGR-${partial.issueId}`,
    title: partial.title ?? "Test error",
    culprit: partial.culprit ?? "src/foo.ts",
    permalink: partial.permalink ?? "https://sentry.io/x",
    stackTrace: partial.stackTrace ?? "",
    eventCount14d: partial.eventCount14d ?? 1,
    firstSeen: partial.firstSeen ?? "2026-04-09T00:00:00Z",
    lastSeen: partial.lastSeen ?? NOW.toISOString(),
    level: partial.level ?? "error",
    environment: partial.environment ?? "development",
    tags: partial.tags ?? {},
  };
}

describe("recencyScore", () => {
  it("returns 1.0 when lastSeen is now", () => {
    expect(recencyScore(NOW.toISOString(), NOW)).toBeCloseTo(1.0, 5);
  });

  it("returns ~0.5 when lastSeen is 24 hours ago", () => {
    const lastSeen = new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString();
    expect(recencyScore(lastSeen, NOW)).toBeCloseTo(0.5, 2);
  });

  it("returns ~0.25 when lastSeen is 48 hours ago", () => {
    const lastSeen = new Date(NOW.getTime() - 48 * 60 * 60 * 1000).toISOString();
    expect(recencyScore(lastSeen, NOW)).toBeCloseTo(0.25, 2);
  });

  it("returns near 0 when lastSeen is 7 days ago", () => {
    const lastSeen = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    expect(recencyScore(lastSeen, NOW)).toBeLessThan(0.01);
  });

  it("clamps to 1.0 for future timestamps (clock skew)", () => {
    const future = new Date(NOW.getTime() + 60 * 1000).toISOString();
    expect(recencyScore(future, NOW)).toBe(1.0);
  });
});

describe("normalizeFrequencies", () => {
  it("normalizes against the max in the batch", () => {
    const issues = [
      makeIssue({ issueId: "1", eventCount14d: 100 }),
      makeIssue({ issueId: "2", eventCount14d: 50 }),
      makeIssue({ issueId: "3", eventCount14d: 25 }),
    ];
    const result = normalizeFrequencies(issues);
    expect(result.get("1")).toBe(1.0);
    expect(result.get("2")).toBe(0.5);
    expect(result.get("3")).toBe(0.25);
  });

  it("returns 0 for all when max is 0", () => {
    const issues = [
      makeIssue({ issueId: "1", eventCount14d: 0 }),
      makeIssue({ issueId: "2", eventCount14d: 0 }),
    ];
    const result = normalizeFrequencies(issues);
    expect(result.get("1")).toBe(0);
    expect(result.get("2")).toBe(0);
  });

  it("returns empty map for empty input", () => {
    expect(normalizeFrequencies([]).size).toBe(0);
  });
});

describe("scoreIssues", () => {
  it("combines frequency (0.6) and recency (0.4)", () => {
    const issues = [
      makeIssue({ issueId: "1", eventCount14d: 100, lastSeen: NOW.toISOString() }),
    ];
    const scored = scoreIssues(issues, NOW);
    expect(scored[0].score).toBeCloseTo(1.0, 5);
  });

  it("weights frequency more than recency", () => {
    const issues = [
      makeIssue({
        issueId: "freq",
        eventCount14d: 100,
        lastSeen: new Date(NOW.getTime() - 48 * 60 * 60 * 1000).toISOString(),
      }),
      makeIssue({
        issueId: "fresh",
        eventCount14d: 10,
        lastSeen: NOW.toISOString(),
      }),
    ];
    const scored = scoreIssues(issues, NOW);
    const freq = scored.find((s) => s.issueId === "freq")!;
    const fresh = scored.find((s) => s.issueId === "fresh")!;
    expect(freq.score).toBeGreaterThan(fresh.score);
  });
});

describe("sortByScore", () => {
  it("sorts descending by score", () => {
    const issues = [
      { ...makeIssue({ issueId: "a" }), score: 0.3 },
      { ...makeIssue({ issueId: "b" }), score: 0.9 },
      { ...makeIssue({ issueId: "c" }), score: 0.5 },
    ];
    const sorted = sortByScore(issues);
    expect(sorted.map((i) => i.issueId)).toEqual(["b", "c", "a"]);
  });

  it("breaks ties within 0.05 by severity (fatal > error > warning)", () => {
    const issues = [
      { ...makeIssue({ issueId: "a", level: "warning" }), score: 0.52 },
      { ...makeIssue({ issueId: "b", level: "fatal" }), score: 0.50 },
      { ...makeIssue({ issueId: "c", level: "error" }), score: 0.51 },
    ];
    const sorted = sortByScore(issues);
    expect(sorted.map((i) => i.issueId)).toEqual(["b", "c", "a"]);
  });

  it("does not apply severity tiebreaker when gap exceeds 0.05", () => {
    const issues = [
      { ...makeIssue({ issueId: "a", level: "warning" }), score: 0.9 },
      { ...makeIssue({ issueId: "b", level: "fatal" }), score: 0.5 },
    ];
    const sorted = sortByScore(issues);
    expect(sorted.map((i) => i.issueId)).toEqual(["a", "b"]);
  });
});
