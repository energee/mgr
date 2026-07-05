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
      statsPeriod: "24h",
      limit: 20,
    });
    expect(url).toContain("/api/0/projects/my-org/my-proj/issues/");
    expect(url).toContain("query=is%3Aunresolved+environment%3Adevelopment");
    expect(url).toContain("statsPeriod=24h");
    expect(url).toContain("limit=20");
  });

  it("defaults to 14d statsPeriod (matches SentryIssue.eventCount14d field) and 20 limit", () => {
    const url = buildIssuesUrl({ org: "o", project: "p", environment: "development" });
    expect(url).toContain("statsPeriod=14d");
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
      eventCount14d: 342,
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
