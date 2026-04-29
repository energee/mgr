# Sentry Error Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an autonomous GitHub Actions workflow that runs twice daily, pulls unresolved Sentry issues, ranks them by frequency and recency, and dispatches Claude Code Action to open thorough, self-reviewed PRs that fix them.

**Architecture:** Three-layer split. A GitHub Actions workflow (`.github/workflows/sentry-harness.yml`) orchestrates. A Bun-run TypeScript script (`.github/scripts/sentry-harness.ts`) handles deterministic work — Sentry API fetch, scoring, dedup, prompt assembly. Claude Code Action runs per error in a matrix, following a 12-step fix pipeline that gates every PR through validate → simplify → code review before surfacing it.

**Tech Stack:** TypeScript, Bun runtime, Vitest, GitHub Actions, `gh` CLI, Sentry REST API v0, `anthropics/claude-code-action@v1`.

**Reference spec:** `docs/superpowers/specs/2026-04-16-sentry-error-harness-design.md`

---

## File Structure

All new code lives outside `src/` to keep it out of the Next.js bundle.

```
.github/
  workflows/
    sentry-harness.yml                       # Workflow (cron + manual trigger)
  scripts/
    sentry-harness.ts                        # Main entry (reads env, orchestrates)
    sentry-harness/
      types.ts                               # SentryIssue, ScoredIssue types
      scoring.ts                             # Pure scoring fns (freq, recency, sort)
      scoring.test.ts
      dedup.ts                               # Extract IDs from PR branches, filter
      dedup.test.ts
      sentry-api.ts                          # URL build, response normalize
      sentry-api.test.ts
      prompt.ts                              # Build per-error Claude prompt
      prompt.test.ts
docs/
  superpowers/
    plans/
      2026-04-16-sentry-error-harness.md     # This file
  sentry-harness-setup.md                    # One-time setup guide (Sentry + secrets)
vitest.config.ts                             # Modified: add .github/scripts to include
```

**Responsibilities:**
- `types.ts` — shared types, single source of truth
- `scoring.ts` — pure functions: normalize frequency, decay recency, combine, stable-sort with severity tiebreaker
- `dedup.ts` — parse `sentry-fix/SENTRY-{id}` branches, return filter predicate
- `sentry-api.ts` — fetch issues + latest events, normalize Sentry response to `SentryIssue`
- `prompt.ts` — assemble the 12-step fix prompt with error data interpolated
- `sentry-harness.ts` — top-level script that wires env → API → score → dedup → prompt → emit JSON
- `sentry-harness.yml` — two jobs: `score-errors` (runs orchestrator) and `fix-error` (matrix over results, invokes Claude Code Action)

---

## Task 1: Update vitest config to include `.github/scripts`

**Files:**
- Modify: `vitest.config.ts`

- [ ] **Step 1: Update the `include` array**

Replace lines 11-12 of `vitest.config.ts`:

```typescript
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      ".github/scripts/**/*.test.ts",
    ],
```

- [ ] **Step 2: Verify vitest still runs**

Run: `bun run test`
Expected: existing test suite passes. No new failures.

- [ ] **Step 3: Commit**

```bash
git add vitest.config.ts
git commit -m "chore: include .github/scripts in vitest config"
```

---

## Task 2: Create shared types module

**Files:**
- Create: `.github/scripts/sentry-harness/types.ts`

- [ ] **Step 1: Write the types file**

```typescript
// .github/scripts/sentry-harness/types.ts

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
```

- [ ] **Step 2: Verify typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add .github/scripts/sentry-harness/types.ts
git commit -m "feat(harness): add shared types for Sentry error harness"
```

---

## Task 3: Implement scoring (TDD)

Pure functions. The scoring formula from the spec:
```
score = (normalized_frequency × 0.6) + (recency_score × 0.4)
```
- `normalized_frequency` = `eventCount7d / max(eventCount7d across batch)`, range 0–1
- `recency_score` = `0.5 ^ (hoursSinceLastSeen / 24)` — half-life 24 hours
- Severity tiebreaker when two scores are within 0.05: `fatal > error > warning > info > debug`

**Files:**
- Create: `.github/scripts/sentry-harness/scoring.ts`
- Test: `.github/scripts/sentry-harness/scoring.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// .github/scripts/sentry-harness/scoring.test.ts
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
    eventCount7d: partial.eventCount7d ?? 1,
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
      makeIssue({ issueId: "1", eventCount7d: 100 }),
      makeIssue({ issueId: "2", eventCount7d: 50 }),
      makeIssue({ issueId: "3", eventCount7d: 25 }),
    ];
    const result = normalizeFrequencies(issues);
    expect(result.get("1")).toBe(1.0);
    expect(result.get("2")).toBe(0.5);
    expect(result.get("3")).toBe(0.25);
  });

  it("returns 0 for all when max is 0", () => {
    const issues = [
      makeIssue({ issueId: "1", eventCount7d: 0 }),
      makeIssue({ issueId: "2", eventCount7d: 0 }),
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
      makeIssue({ issueId: "1", eventCount7d: 100, lastSeen: NOW.toISOString() }),
    ];
    const scored = scoreIssues(issues, NOW);
    // normalized freq = 1.0, recency = 1.0, score = 0.6 + 0.4 = 1.0
    expect(scored[0].score).toBeCloseTo(1.0, 5);
  });

  it("weights frequency more than recency", () => {
    const issues = [
      // High freq, old
      makeIssue({
        issueId: "freq",
        eventCount7d: 100,
        lastSeen: new Date(NOW.getTime() - 48 * 60 * 60 * 1000).toISOString(),
      }),
      // Low freq, fresh
      makeIssue({
        issueId: "fresh",
        eventCount7d: 10,
        lastSeen: NOW.toISOString(),
      }),
    ];
    const scored = scoreIssues(issues, NOW);
    const freq = scored.find((s) => s.issueId === "freq")!;
    const fresh = scored.find((s) => s.issueId === "fresh")!;
    // freq: (1.0 * 0.6) + (0.25 * 0.4) = 0.7
    // fresh: (0.1 * 0.6) + (1.0 * 0.4) = 0.46
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
    // All within 0.05 of each other — ordered by severity
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test .github/scripts/sentry-harness/scoring.test.ts`
Expected: FAIL — `Cannot find module './scoring'`.

- [ ] **Step 3: Write the implementation**

```typescript
// .github/scripts/sentry-harness/scoring.ts
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

export function recencyScore(lastSeenIso: string, now: Date = new Date()): number {
  const diffMs = now.getTime() - new Date(lastSeenIso).getTime();
  if (diffMs <= 0) return 1.0;
  const hours = diffMs / (1000 * 60 * 60);
  return Math.pow(0.5, hours / RECENCY_HALF_LIFE_HOURS);
}

export function normalizeFrequencies(issues: SentryIssue[]): Map<string, number> {
  const result = new Map<string, number>();
  if (issues.length === 0) return result;
  const max = Math.max(...issues.map((i) => i.eventCount7d));
  for (const issue of issues) {
    result.set(issue.issueId, max === 0 ? 0 : issue.eventCount7d / max);
  }
  return result;
}

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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test .github/scripts/sentry-harness/scoring.test.ts`
Expected: PASS — 13 tests passing.

- [ ] **Step 5: Commit**

```bash
git add .github/scripts/sentry-harness/scoring.ts .github/scripts/sentry-harness/scoring.test.ts
git commit -m "feat(harness): add scoring algorithm with freq + recency + severity tiebreak"
```

---

## Task 4: Implement PR dedup (TDD)

**Files:**
- Create: `.github/scripts/sentry-harness/dedup.ts`
- Test: `.github/scripts/sentry-harness/dedup.test.ts`

Branch format: `sentry-fix/SENTRY-{issueId}` where `issueId` is the numeric Sentry ID.

- [ ] **Step 1: Write the failing tests**

```typescript
// .github/scripts/sentry-harness/dedup.test.ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test .github/scripts/sentry-harness/dedup.test.ts`
Expected: FAIL — `Cannot find module './dedup'`.

- [ ] **Step 3: Write the implementation**

```typescript
// .github/scripts/sentry-harness/dedup.ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test .github/scripts/sentry-harness/dedup.test.ts`
Expected: PASS — 7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add .github/scripts/sentry-harness/dedup.ts .github/scripts/sentry-harness/dedup.test.ts
git commit -m "feat(harness): add PR branch dedup filter"
```

---

## Task 5: Implement Sentry API client (TDD)

The Sentry API returns issues with fields like `id`, `shortId`, `title`, `culprit`, `permalink`, `count` (string), `firstSeen`, `lastSeen`, `level`, `tags` (array of `{key,value}`). We need to fetch issues and their latest events (for stack traces), then normalize to our `SentryIssue` type.

Split into pure functions (URL building, response normalization, stack trace formatting) and one thin fetch wrapper.

**Files:**
- Create: `.github/scripts/sentry-harness/sentry-api.ts`
- Test: `.github/scripts/sentry-harness/sentry-api.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// .github/scripts/sentry-harness/sentry-api.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildIssuesUrl,
  buildLatestEventUrl,
  formatStackTrace,
  normalizeIssue,
  fetchIssuesWithStacks,
} from "./sentry-api";

describe("buildIssuesUrl", () => {
  it("encodes org, project, environment, and statsPeriod in the URL", () => {
    const url = buildIssuesUrl({
      org: "my-org",
      project: "my-proj",
      environment: "development",
      statsPeriod: "7d",
      limit: 20,
    });
    expect(url).toContain("/api/0/projects/my-org/my-proj/issues/");
    expect(url).toContain("query=is%3Aunresolved+environment%3Adevelopment");
    expect(url).toContain("statsPeriod=7d");
    expect(url).toContain("limit=20");
  });

  it("defaults to 7d statsPeriod and 20 limit", () => {
    const url = buildIssuesUrl({ org: "o", project: "p", environment: "development" });
    expect(url).toContain("statsPeriod=7d");
    expect(url).toContain("limit=20");
  });

  it("omits environment filter when not provided", () => {
    const url = buildIssuesUrl({ org: "o", project: "p" });
    expect(url).toContain("query=is%3Aunresolved");
    expect(url).not.toContain("environment");
  });
});

describe("buildLatestEventUrl", () => {
  it("builds the latest-event endpoint path", () => {
    expect(buildLatestEventUrl("12345")).toBe(
      "https://sentry.io/api/0/issues/12345/events/latest/",
    );
  });
});

describe("formatStackTrace", () => {
  it("formats entries[].data.frames into filename:lineno in function()", () => {
    const event = {
      entries: [
        {
          type: "exception",
          data: {
            values: [
              {
                type: "TypeError",
                value: "x is undefined",
                stacktrace: {
                  frames: [
                    { filename: "src/a.ts", lineNo: 10, function: "foo" },
                    { filename: "src/b.ts", lineNo: 22, function: "bar" },
                  ],
                },
              },
            ],
          },
        },
      ],
    };
    const trace = formatStackTrace(event);
    expect(trace).toContain("TypeError: x is undefined");
    expect(trace).toContain("at foo (src/a.ts:10)");
    expect(trace).toContain("at bar (src/b.ts:22)");
  });

  it("returns empty string when no exception entry present", () => {
    expect(formatStackTrace({ entries: [] })).toBe("");
    expect(formatStackTrace({})).toBe("");
  });
});

describe("normalizeIssue", () => {
  it("maps Sentry API fields to SentryIssue", () => {
    const raw = {
      id: "12345",
      shortId: "MGR-42",
      title: "TypeError: x is undefined",
      culprit: "src/lib/foo.ts in handleBar",
      permalink: "https://sentry.io/organizations/my-org/issues/12345/",
      count: "342",
      firstSeen: "2026-04-14T09:00:00Z",
      lastSeen: "2026-04-16T14:00:00Z",
      level: "error",
    };
    const tags = [
      { key: "environment", value: "development" },
      { key: "browser", value: "Chrome 130" },
    ];
    const issue = normalizeIssue(raw, tags, "stack trace text");
    expect(issue).toMatchObject({
      issueId: "12345",
      shortId: "MGR-42",
      title: "TypeError: x is undefined",
      eventCount7d: 342,
      level: "error",
      environment: "development",
      stackTrace: "stack trace text",
    });
    expect(issue.tags.browser).toBe("Chrome 130");
  });

  it("defaults environment to 'unknown' when not in tags", () => {
    const raw = {
      id: "1",
      shortId: "MGR-1",
      title: "t",
      culprit: "c",
      permalink: "p",
      count: "0",
      firstSeen: "2026-04-14T09:00:00Z",
      lastSeen: "2026-04-16T14:00:00Z",
      level: "error",
    };
    const issue = normalizeIssue(raw, [], "");
    expect(issue.environment).toBe("unknown");
  });

  it("defaults unknown level to 'error'", () => {
    const raw = {
      id: "1",
      shortId: "MGR-1",
      title: "t",
      culprit: "c",
      permalink: "p",
      count: "0",
      firstSeen: "2026-04-14T09:00:00Z",
      lastSeen: "2026-04-16T14:00:00Z",
      level: "weird-value",
    };
    const issue = normalizeIssue(raw, [], "");
    expect(issue.level).toBe("error");
  });
});

describe("fetchIssuesWithStacks (integration with mocked fetch)", () => {
  const originalFetch = globalThis.fetch;
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches the issue list then latest events per issue", async () => {
    mockFetch
      // Issues list
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            id: "1",
            shortId: "MGR-1",
            title: "err",
            culprit: "c",
            permalink: "p",
            count: "5",
            firstSeen: "2026-04-14T09:00:00Z",
            lastSeen: "2026-04-16T14:00:00Z",
            level: "error",
          },
        ],
      })
      // Latest event for issue 1
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tags: [{ key: "environment", value: "development" }],
          entries: [
            {
              type: "exception",
              data: {
                values: [
                  {
                    type: "Error",
                    value: "boom",
                    stacktrace: { frames: [{ filename: "a.ts", lineNo: 1, function: "f" }] },
                  },
                ],
              },
            },
          ],
        }),
      });

    const issues = await fetchIssuesWithStacks({
      org: "o",
      project: "p",
      authToken: "t",
      environment: "development",
    });

    expect(issues).toHaveLength(1);
    expect(issues[0].issueId).toBe("1");
    expect(issues[0].environment).toBe("development");
    expect(issues[0].stackTrace).toContain("Error: boom");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: "Bearer t",
    });
  });

  it("throws when issues list returns non-2xx", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "unauthorized",
    });
    await expect(
      fetchIssuesWithStacks({ org: "o", project: "p", authToken: "bad" }),
    ).rejects.toThrow(/401/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test .github/scripts/sentry-harness/sentry-api.test.ts`
Expected: FAIL — `Cannot find module './sentry-api'`.

- [ ] **Step 3: Write the implementation**

```typescript
// .github/scripts/sentry-harness/sentry-api.ts
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

type RawEvent = {
  tags?: RawTag[];
  entries?: Array<{
    type: string;
    data?: {
      values?: Array<{
        type?: string;
        value?: string;
        stacktrace?: { frames?: RawFrame[] };
      }>;
    };
  }>;
};

const VALID_LEVELS: SentryIssue["level"][] = ["fatal", "error", "warning", "info", "debug"];

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
    statsPeriod: opts.statsPeriod ?? "7d",
    limit: String(opts.limit ?? 20),
    sort: "freq",
  });
  return `${SENTRY_BASE}/api/0/projects/${opts.org}/${opts.project}/issues/?${params.toString()}`;
}

export function buildLatestEventUrl(issueId: string): string {
  return `${SENTRY_BASE}/api/0/issues/${issueId}/events/latest/`;
}

export function formatStackTrace(event: RawEvent): string {
  const exceptionEntry = event.entries?.find((e) => e.type === "exception");
  const values = exceptionEntry?.data?.values ?? [];
  if (values.length === 0) return "";
  const parts: string[] = [];
  for (const v of values) {
    parts.push(`${v.type ?? "Error"}: ${v.value ?? ""}`);
    const frames = v.stacktrace?.frames ?? [];
    for (const frame of frames.slice().reverse()) {
      const fn = frame.function ?? "<anonymous>";
      const file = frame.filename ?? "<unknown>";
      const line = frame.lineNo ?? 0;
      parts.push(`  at ${fn} (${file}:${line})`);
    }
  }
  return parts.join("\n");
}

export function normalizeIssue(
  raw: RawIssue,
  tags: RawTag[],
  stackTrace: string,
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
    eventCount7d: Number.parseInt(raw.count, 10) || 0,
    firstSeen: raw.firstSeen,
    lastSeen: raw.lastSeen,
    level,
    environment: tagMap.environment ?? "unknown",
    tags: tagMap,
  };
}

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
    results.push(normalizeIssue(raw, event.tags ?? [], formatStackTrace(event)));
  }
  return results;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test .github/scripts/sentry-harness/sentry-api.test.ts`
Expected: PASS — 11 tests passing.

- [ ] **Step 5: Commit**

```bash
git add .github/scripts/sentry-harness/sentry-api.ts .github/scripts/sentry-harness/sentry-api.test.ts
git commit -m "feat(harness): add Sentry API client with issue + stack trace fetch"
```

---

## Task 6: Build per-error Claude Code prompt (TDD)

The prompt template includes the 12-step pipeline, guardrails, PR body template, and diagnostic fallback. Error data is interpolated at build time so the workflow can pass `matrix.error.prompt` directly to the action.

**Files:**
- Create: `.github/scripts/sentry-harness/prompt.ts`
- Test: `.github/scripts/sentry-harness/prompt.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// .github/scripts/sentry-harness/prompt.test.ts
import { describe, expect, it } from "vitest";
import { buildFixPrompt } from "./prompt";
import type { SentryIssue } from "./types";

const issue: SentryIssue = {
  issueId: "12345",
  shortId: "MGR-42",
  title: "TypeError: Cannot read property 'name' of undefined",
  culprit: "src/lib/foo.ts in handleBar",
  permalink: "https://sentry.io/organizations/x/issues/12345/",
  stackTrace: "TypeError: ...\n  at handleBar (src/lib/foo.ts:42)",
  eventCount7d: 342,
  firstSeen: "2026-04-14T09:00:00Z",
  lastSeen: "2026-04-16T14:00:00Z",
  level: "error",
  environment: "development",
  tags: { browser: "Chrome 130", url: "/production/batches/..." },
};

describe("buildFixPrompt", () => {
  it("includes all core error fields in the prompt", () => {
    const prompt = buildFixPrompt(issue);
    expect(prompt).toContain("12345");
    expect(prompt).toContain("MGR-42");
    expect(prompt).toContain("TypeError: Cannot read property 'name' of undefined");
    expect(prompt).toContain("src/lib/foo.ts in handleBar");
    expect(prompt).toContain("handleBar (src/lib/foo.ts:42)");
    expect(prompt).toContain("342");
  });

  it("enumerates the 12-step pipeline", () => {
    const prompt = buildFixPrompt(issue);
    for (let i = 1; i <= 12; i++) {
      expect(prompt).toContain(`${i}.`);
    }
  });

  it("mentions required quality gates (simplify, code-review)", () => {
    const prompt = buildFixPrompt(issue);
    expect(prompt).toContain("/simplify");
    expect(prompt).toContain("/code-review:code-review");
  });

  it("specifies branch naming and labels", () => {
    const prompt = buildFixPrompt(issue);
    expect(prompt).toContain("sentry-fix/SENTRY-12345");
    expect(prompt).toContain("sentry-fix");
    expect(prompt).toContain("automated");
  });

  it("includes diagnostic-PR fallback with needs-human label", () => {
    const prompt = buildFixPrompt(issue);
    expect(prompt).toContain("needs-human");
    expect(prompt).toContain("diagnostic");
  });

  it("references CLAUDE.md conventions", () => {
    const prompt = buildFixPrompt(issue);
    expect(prompt).toContain("CLAUDE.md");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test .github/scripts/sentry-harness/prompt.test.ts`
Expected: FAIL — `Cannot find module './prompt'`.

- [ ] **Step 3: Write the implementation**

```typescript
// .github/scripts/sentry-harness/prompt.ts
import type { SentryIssue } from "./types";

export function buildFixPrompt(issue: SentryIssue): string {
  const tagLines = Object.entries(issue.tags)
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join("\n");

  return `You are the Sentry Error Harness. Your job is to fix ONE production error thoroughly.

## Error Details

- **Issue ID**: ${issue.issueId}
- **Short ID**: ${issue.shortId}
- **Title**: ${issue.title}
- **Culprit**: ${issue.culprit}
- **Environment**: ${issue.environment}
- **Level**: ${issue.level}
- **Events (7d)**: ${issue.eventCount7d}
- **First seen**: ${issue.firstSeen}
- **Last seen**: ${issue.lastSeen}
- **Sentry link**: ${issue.permalink}

### Tags
${tagLines || "  (none)"}

### Stack Trace
\`\`\`
${issue.stackTrace || "(unavailable)"}
\`\`\`

## Pipeline (follow in order)

1. **Trace stack trace** — resolve each frame to a source file. Read the code around each frame.
2. **Root cause analysis** — determine *why* the error occurs. Null safety? Race condition? Stale state? Missing error boundary? Write the analysis out before fixing.
3. **Pattern scan** — use Grep to find similar vulnerabilities elsewhere in the codebase. If found, include them in the fix scope.
4. **Implement the fix** — minimal and targeted. Follow the conventions in CLAUDE.md: entity configs, universal components, centralized query keys from \`src/lib/query-keys.ts\`, no hardcoded status maps (DEC-007), no empty-string Select values (DEC-008), security_invoker on views, RLS on new tables.
5. **Add tests** — write a Vitest test that reproduces the error condition. Confirm it fails on the original code, then passes on the fix.
6. **Validate** — run \`bun run typecheck\`, \`bun run test\`, \`bun lint\`. All three must pass.
7. **Simplify** — invoke \`/simplify\` to review the changed code for reuse, quality, and efficiency. Apply fixes.
8. **Re-validate** — if step 7 changed anything, run \`bun run typecheck\`, \`bun run test\`, \`bun lint\` again.
9. **Code review** — invoke \`/code-review:code-review\` on the diff. Surface bugs, logic errors, security issues, convention violations.
10. **Apply review fixes** — address each finding from step 9.
11. **Re-validate** — if step 10 changed anything, run \`bun run typecheck\`, \`bun run test\`, \`bun lint\` again.
12. **Open the PR** — create branch \`sentry-fix/SENTRY-${issue.issueId}\`, push, and open a PR with the template below. Apply labels \`sentry-fix\` and \`automated\`.

## Guardrails

- Follow CLAUDE.md conventions strictly. Do not invent new patterns.
- Do not modify unrelated code. No opportunistic refactors.
- Do not skip hooks (\`--no-verify\`) or bypass validation.
- If validation fails 3 times in a row, do NOT force a bad fix. Stop and open a **diagnostic PR** instead (see below).
- Do not create documentation files unless the fix requires them.

## Diagnostic PR Fallback

If after 3 attempts you cannot produce a working fix, OR the root cause is outside this codebase (infrastructure, third-party library, stale data), open a PR that:

- Adds better error handling or logging at the failure point.
- Documents the root cause analysis in the PR body.
- Applies labels \`sentry-fix\`, \`automated\`, AND \`needs-human\`.

## PR Body Template

\`\`\`markdown
## Sentry Fix: ${issue.title}

**Issue:** [${issue.shortId}](${issue.permalink}) | **Events (7d):** ${issue.eventCount7d} | **First seen:** ${issue.firstSeen} | **Last seen:** ${issue.lastSeen}

### Root Cause
<deep analysis with file:line references>

### Fix
<what changed and why — specific files and logic>

### Related Patterns
<other locations with the same vulnerability, if any, and whether they were addressed>

### Test Plan
- [x] Reproducing test added at <path>
- [x] Fix verified (test passes)
- [x] Full test suite passes
- [x] Type check clean
- [x] Lint clean
- [x] /simplify pass completed
- [x] /code-review pass completed
\`\`\`

Begin with step 1.`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test .github/scripts/sentry-harness/prompt.test.ts`
Expected: PASS — 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add .github/scripts/sentry-harness/prompt.ts .github/scripts/sentry-harness/prompt.test.ts
git commit -m "feat(harness): add per-error fix prompt builder"
```

---

## Task 7: Wire main orchestrator entry point

Reads env vars, fetches issues, scores, runs `gh` to list open sentry-fix PRs, filters, picks top 5, builds prompts, writes JSON to `$GITHUB_OUTPUT`.

**Files:**
- Create: `.github/scripts/sentry-harness.ts`

- [ ] **Step 1: Write the orchestrator script**

```typescript
#!/usr/bin/env bun
// .github/scripts/sentry-harness.ts
//
// Entry point for the Sentry Error Harness. Run inside GitHub Actions.
// Reads env, fetches unresolved Sentry issues, scores them, excludes those
// that already have an open PR, and emits up to 5 as GITHUB_OUTPUT for a
// matrix job to consume.

import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { filterClaimedIssues } from "./sentry-harness/dedup";
import { buildFixPrompt } from "./sentry-harness/prompt";
import { scoreIssues, sortByScore } from "./sentry-harness/scoring";
import { fetchIssuesWithStacks } from "./sentry-harness/sentry-api";
import type { ScoredIssue } from "./sentry-harness/types";

const MAX_ERRORS_PER_RUN = 5;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function listOpenSentryFixBranches(): string[] {
  const result = spawnSync(
    "gh",
    ["pr", "list", "--state", "open", "--search", "head:sentry-fix/", "--json", "headRefName", "--limit", "100"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`gh pr list failed: ${result.stderr}`);
  }
  const parsed = JSON.parse(result.stdout) as Array<{ headRefName: string }>;
  return parsed.map((p) => p.headRefName);
}

function writeOutput(name: string, value: string): void {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) {
    console.log(`${name}=${value}`);
    return;
  }
  const delimiter = `EOF_${Date.now()}`;
  appendFileSync(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

async function main(): Promise<void> {
  const authToken = requireEnv("SENTRY_AUTH_TOKEN");
  const org = requireEnv("SENTRY_ORG");
  const project = requireEnv("SENTRY_PROJECT");
  const environment = process.env.SENTRY_ENVIRONMENT || "development";

  console.error(`[harness] Fetching Sentry issues for ${org}/${project} (env: ${environment})`);
  const issues = await fetchIssuesWithStacks({ org, project, authToken, environment });
  console.error(`[harness] Fetched ${issues.length} issues`);

  const openBranches = listOpenSentryFixBranches();
  console.error(`[harness] ${openBranches.length} open sentry-fix PRs`);
  const eligible = filterClaimedIssues(issues, openBranches);
  console.error(`[harness] ${eligible.length} eligible after dedup`);

  const scored = scoreIssues(eligible);
  const sorted = sortByScore(scored);
  const top = sorted.slice(0, MAX_ERRORS_PER_RUN);

  const output: ScoredIssue[] = top.map((issue) => ({
    ...issue,
    prompt: buildFixPrompt(issue),
  }));

  console.error(`[harness] Emitting ${output.length} errors for fix-error matrix`);
  writeOutput("errors", JSON.stringify(output));
  writeOutput("count", String(output.length));
}

main().catch((err: unknown) => {
  console.error("[harness] Fatal:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Verify the file is executable by bun**

Run: `bun --print '"ok"' .github/scripts/sentry-harness.ts 2>&1 | head -1; echo "---"; bun --help | head -1`
Expected: no syntax errors reported by `bun`.

(Full end-to-end execution requires real Sentry credentials and is exercised via the workflow, not locally.)

- [ ] **Step 4: Commit**

```bash
git add .github/scripts/sentry-harness.ts
git commit -m "feat(harness): add main orchestrator entry point"
```

---

## Task 8: Create GitHub Actions workflow

**Files:**
- Create: `.github/workflows/sentry-harness.yml`

- [ ] **Step 1: Write the workflow**

```yaml
# .github/workflows/sentry-harness.yml
#
# Sentry Error Harness. Runs twice daily (noon and 5pm EST) and on manual
# dispatch. Score job pulls unresolved Sentry issues, ranks them, and emits
# up to 5 for the fix-error matrix. Each matrix job invokes Claude Code
# Action to analyze and fix one error, then opens a PR.

name: Sentry Error Harness

on:
  schedule:
    - cron: "0 17 * * *"   # Noon EST (UTC-5)
    - cron: "0 22 * * *"   # 5pm EST (UTC-5)
  workflow_dispatch:

jobs:
  score-errors:
    name: Score Sentry errors
    runs-on: ubuntu-latest
    outputs:
      errors: ${{ steps.score.outputs.errors }}
      count: ${{ steps.score.outputs.count }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.2.9

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Score Sentry issues
        id: score
        run: bun run .github/scripts/sentry-harness.ts
        env:
          SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
          SENTRY_ORG: ${{ secrets.SENTRY_ORG }}
          SENTRY_PROJECT: ${{ secrets.SENTRY_PROJECT }}
          SENTRY_ENVIRONMENT: development
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  fix-error:
    name: Fix error (${{ matrix.error.shortId }})
    needs: score-errors
    if: fromJSON(needs.score-errors.outputs.count) > 0
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: read
      id-token: write
      actions: read
    strategy:
      fail-fast: false
      max-parallel: 1
      matrix:
        error: ${{ fromJSON(needs.score-errors.outputs.errors) }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Run Claude Code Action
        uses: anthropics/claude-code-action@v1
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          plugin_marketplaces: "https://github.com/anthropics/claude-code.git"
          plugins: "code-review@claude-code-plugins"
          prompt: ${{ matrix.error.prompt }}
          additional_permissions: |
            actions: read
```

- [ ] **Step 2: Validate the workflow syntax**

Run: `bun x --bun @action-validator/cli .github/workflows/sentry-harness.yml 2>&1 || echo "validator not installed, manual review required"`
Expected: no syntax errors, or a message to review manually. If the validator isn't available, skim the YAML for indentation and required fields.

- [ ] **Step 3: Verify lint passes**

Run: `bun lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/sentry-harness.yml
git commit -m "feat(harness): add Sentry error harness workflow"
```

---

## Task 9: Write prerequisites documentation

**Files:**
- Create: `docs/sentry-harness-setup.md`

- [ ] **Step 1: Write the setup guide**

```markdown
# Sentry Error Harness — Setup Guide

This document covers the one-time setup required before the Sentry Error
Harness workflow can run. See
[the design spec](./superpowers/specs/2026-04-16-sentry-error-harness-design.md)
and [the implementation plan](./superpowers/plans/2026-04-16-sentry-error-harness.md)
for context.

## Prerequisites

### 1. Create a Sentry project

1. Sign in at https://sentry.io (or your self-hosted instance).
2. Create a new project of type **Next.js**.
3. Copy the DSN from the "Client Keys" settings page.

### 2. Configure local Sentry reporting

1. Open `.env` at the repo root.
2. Add:

   \`\`\`
   NEXT_PUBLIC_SENTRY_DSN=https://<public-key>@o<org-id>.ingest.sentry.io/<project-id>
   \`\`\`

3. Restart `bun dev`. Trigger any error in the app (e.g., open a page that
   throws). Confirm the error appears in the Sentry dashboard within ~30
   seconds.

### 3. Create a Sentry auth token

The harness reads issues via the Sentry REST API.

1. In Sentry, go to **Settings → Account → User Auth Tokens**.
2. Create a token with scopes:
   - \`project:read\`
   - \`event:read\`
3. Copy the token value — it is shown only once.

### 4. Add GitHub repository secrets

Under **Settings → Secrets and variables → Actions** add:

| Name | Value |
|------|-------|
| \`SENTRY_AUTH_TOKEN\` | The user auth token from step 3 |
| \`SENTRY_ORG\` | Your Sentry org slug (e.g. \`acme-brewing\`) |
| \`SENTRY_PROJECT\` | Your Sentry project slug (e.g. \`mgr\`) |

\`CLAUDE_CODE_OAUTH_TOKEN\` is already configured for the existing Claude
Code workflows and is reused here.

### 5. (Optional) Create PR labels

The harness applies three labels to PRs it opens. GitHub auto-creates
labels on first use, but you can create them up front for consistent
colors.

- \`sentry-fix\` — applied to every harness PR
- \`automated\` — applied to every harness PR
- \`needs-human\` — applied to diagnostic PRs when the harness could not
  produce a working fix

## Verifying the harness

1. Go to **Actions → Sentry Error Harness → Run workflow** and start a
   manual dispatch.
2. The \`score-errors\` job should run to completion and log how many
   issues were scored. If no issues exist yet, the workflow ends green
   with \`count: 0\`.
3. Trigger a deliberate error in local dev to seed Sentry, wait a minute,
   then re-run the workflow. A \`fix-error\` job should spawn and open a
   PR.

## Scheduling

The workflow runs automatically at:

- \`17:00 UTC\` — noon EST
- \`22:00 UTC\` — 5pm EST

DST transitions shift the local run time by one hour. Acceptable for this
use case.

## Troubleshooting

- **\`401 Unauthorized\` from Sentry** — the auth token is missing scopes
  or expired. Regenerate with \`project:read\` + \`event:read\`.
- **No issues found, but Sentry dashboard shows errors** — confirm
  \`SENTRY_ORG\` and \`SENTRY_PROJECT\` slugs. Verify the environment tag
  on your errors matches \`SENTRY_ENVIRONMENT\` in the workflow (defaults
  to \`development\`).
- **\`fix-error\` opens a PR labeled \`needs-human\`** — the harness
  could not produce a working fix after 3 attempts. Read the PR body for
  the root-cause analysis and finish manually.
- **Duplicate PRs across runs** — this should not happen. If it does,
  check that open PRs use the exact branch format
  \`sentry-fix/SENTRY-<numeric-issue-id>\`; any variation will break
  dedup.
```

- [ ] **Step 2: Commit**

```bash
git add docs/sentry-harness-setup.md
git commit -m "docs(harness): add Sentry Error Harness setup guide"
```

---

## Task 10: Final validation and push

- [ ] **Step 1: Run full type check**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 2: Run full test suite**

Run: `bun run test`
Expected: all tests pass, including the new scoring, dedup, sentry-api, and prompt test files.

- [ ] **Step 3: Run lint**

Run: `bun lint`
Expected: no errors.

- [ ] **Step 4: Verify git status is clean**

Run: `git status`
Expected: "nothing to commit, working tree clean".

- [ ] **Step 5: Push the branch**

Run: `git push -u origin feat/error-harness`
Expected: remote branch created.

- [ ] **Step 6: Open a PR**

Run:

```bash
gh pr create --title "feat: Sentry error harness (autonomous fix loop)" --body "$(cat <<'EOF'
## Summary
- Autonomous GitHub Actions workflow that runs twice daily (noon + 5pm EST) and pulls unresolved Sentry issues.
- Orchestrator script ranks issues by frequency + recency, dedups against open sentry-fix PRs, and emits up to 5 per run.
- Each error is handed to Claude Code Action via a matrix job that follows a 12-step fix pipeline (validate → simplify → code review) before opening a PR.

## Files
- `.github/workflows/sentry-harness.yml` — workflow with cron + manual dispatch.
- `.github/scripts/sentry-harness.ts` — orchestrator entry point.
- `.github/scripts/sentry-harness/` — pure modules (scoring, dedup, sentry-api, prompt) with Vitest coverage.
- `docs/sentry-harness-setup.md` — one-time setup guide.
- `docs/superpowers/specs/2026-04-16-sentry-error-harness-design.md` — design spec.
- `docs/superpowers/plans/2026-04-16-sentry-error-harness.md` — implementation plan.

## Test plan
- [x] Unit tests pass (`bun run test`).
- [x] Type check clean (`bun run typecheck`).
- [x] Lint clean (`bun lint`).
- [ ] Add GitHub secrets `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`.
- [ ] Set `NEXT_PUBLIC_SENTRY_DSN` in local `.env` so dev errors reach Sentry.
- [ ] Trigger manual dispatch of the workflow and verify a PR opens for a seeded error.
EOF
)"
```

Expected: PR URL printed.

---

## Out of Scope (Future Work)

Explicitly not in this plan — revisit after running the harness for a few weeks:

- Tuning scoring weights based on observed PR quality.
- Handling the `production` environment (currently hard-coded to `development`).
- Slack / email notification when the harness opens a `needs-human` diagnostic PR.
- Metrics dashboard tracking harness effectiveness (merge rate, time-to-merge).
- Fetching historical event counts per hour to improve recency signal.
