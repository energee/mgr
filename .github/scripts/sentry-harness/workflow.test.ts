import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/sentry-harness.yml"),
  "utf8",
);

describe("Sentry harness workflow", () => {
  it("allows the scoring job to read pull requests for deduplication", () => {
    const scoreJob = workflow.match(/  score-errors:\n([\s\S]*?)\n  fix-error:/)?.[1];

    expect(scoreJob).toBeDefined();
    expect(scoreJob).toMatch(
      /\n    permissions:\n      contents: read\n      pull-requests: read\n/,
    );
  });
});
