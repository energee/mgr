import { describe, expect, it } from "vitest";
import { bucketPulls, renderTable } from "./loop-scoreboard";

const SINCE = "2026-06-26T00:00:00.000Z";

function pull(
  label: string,
  createdAt: string,
  state: "open" | "closed",
  mergedAt: string | null,
) {
  return {
    created_at: createdAt,
    merged_at: mergedAt,
    state,
    labels: [{ name: label }],
  };
}

describe("loop scoreboard", () => {
  it("buckets PRs per loop label into opened/merged/closed-unmerged/open", () => {
    const tallies = bucketPulls(
      [
        pull("bug-patrol", "2026-07-01T07:30:00Z", "closed", "2026-07-01T15:00:00Z"),
        pull("bug-patrol", "2026-07-02T07:30:00Z", "closed", null),
        pull("bug-patrol", "2026-07-03T07:30:00Z", "open", null),
        // Outside the window — ignored entirely.
        pull("bug-patrol", "2026-06-01T07:30:00Z", "closed", "2026-06-01T15:00:00Z"),
        // Unknown label — ignored.
        pull("dependencies", "2026-07-04T07:30:00Z", "open", null),
        pull("sentry-fix", "2026-07-05T17:30:00Z", "closed", "2026-07-06T12:00:00Z"),
      ],
      SINCE,
    );

    expect(tallies.get("bug-patrol")).toEqual({
      opened: 3,
      merged: 1,
      closedUnmerged: 1,
      stillOpen: 1,
    });
    expect(tallies.get("sentry-fix")).toEqual({
      opened: 1,
      merged: 1,
      closedUnmerged: 0,
      stillOpen: 0,
    });
    expect(tallies.get("feedback-distill")).toEqual({
      opened: 0,
      merged: 0,
      closedUnmerged: 0,
      stillOpen: 0,
    });
    expect(tallies.has("dependencies")).toBe(false);
  });

  it("renders every loop as a table row with run counts and the needs-human backlog", () => {
    const tallies = bucketPulls(
      [pull("quality-regrade", "2026-07-06T06:30:00Z", "open", null)],
      SINCE,
    );
    const table = renderTable(
      tallies,
      new Map([
        ["bug-patrol.yml", 28],
        ["quality-regrade.yml", null],
      ]),
      3,
      SINCE,
    );

    expect(table).toContain("## Loop scoreboard (since 2026-06-26)");
    expect(table).toContain("| bug-patrol | 28 | 0 | 0 | 0 | 0 |");
    expect(table).toContain("| quality-regrade | – | 1 | 0 | 0 | 1 |");
    expect(table).toContain("| sentry-fix |");
    expect(table).toContain("| feedback-distill |");
    expect(table).toContain("Open needs-human issues: 3");
  });
});
