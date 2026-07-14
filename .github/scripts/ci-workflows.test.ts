import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

const workflows = [
  ".github/workflows/claude-code-review.yml",
  ".github/workflows/claude.yml",
  ".github/workflows/db-lint.yml",
  ".github/workflows/live-drift.yml",
  ".github/workflows/progress.yml",
  ".github/workflows/quality-regrade.yml",
  ".github/workflows/sentry-harness.yml",
  ".github/workflows/shell-lint.yml",
  ".github/workflows/test.yml",
];

describe("GitHub Actions performance contracts", () => {
  it("uses the current checkout and artifact action generations", () => {
    const contents = workflows.map(read).join("\n");

    expect(contents).not.toContain("actions/checkout@v4");
    expect(contents).not.toContain("actions/upload-artifact@v4");
    expect(contents).toContain("actions/checkout@v7");
    expect(contents).toContain("actions/upload-artifact@v7");
    expect(contents).toContain("actions/download-artifact@v8");
  });

  it("runs static checks before sharded unit coverage and the cached build", () => {
    const workflow = read(".github/workflows/test.yml");

    expect(workflow).toContain("matrix:");
    expect(workflow).toMatch(/shard:\s*\[1, 2\]/);
    expect(workflow).toContain("--shard=${{ matrix.shard }}/2");
    expect(workflow).toContain("--merge-reports");
    expect(workflow).toContain("include-hidden-files: true");
    expect(workflow).toContain(".next/cache");
    expect(workflow).toContain(".eslintcache");
    expect(workflow).toContain("tsconfig.tsbuildinfo");
    expect(workflow).toContain("make check-db");
    expect(workflow).toContain("make check-wip");
    expect(workflow).toContain("make check-agent-config");
    expect(workflows.map(read).join("\n")).not.toContain("cache: true");
  });

  it("replays migrations once for DB lint and integration tests", () => {
    const dbWorkflow = read(".github/workflows/db-lint.yml");
    const testWorkflow = read(".github/workflows/test.yml");
    const shellWorkflow = read(".github/workflows/shell-lint.yml");

    expect(dbWorkflow).toContain("concurrency:");
    expect(dbWorkflow).toContain("bun run test:integration");
    expect(dbWorkflow).toContain("supabase/setup-cli@v3");
    expect(dbWorkflow).toContain('version: "2.109.1"');
    expect(dbWorkflow).not.toContain("Lint shell scripts");
    expect(testWorkflow).not.toContain("Integration Tests (RLS)");
    expect(shellWorkflow).toContain("shellcheck");
    expect(shellWorkflow).not.toContain("postgres:");
  });

  it("avoids setup work when scheduled automation has nothing to do", () => {
    const qualityWorkflow = read(".github/workflows/quality-regrade.yml");
    const computeAt = qualityWorkflow.indexOf("Compute lookback window");
    const setupAt = qualityWorkflow.indexOf("Setup Bun");

    expect(computeAt).toBeGreaterThan(-1);
    expect(setupAt).toBeGreaterThan(computeAt);
    expect(qualityWorkflow).toMatch(
      /- name: Setup Bun\n\s+if: steps\.window\.outputs\.commit_count != '0'/,
    );
    expect(qualityWorkflow).toMatch(
      /- name: Install dependencies\n\s+if: steps\.window\.outputs\.commit_count != '0'/,
    );
  });

  it("uses built-in psql and parallelizes only the selected Sentry fixes", () => {
    const driftWorkflow = read(".github/workflows/live-drift.yml");
    const sentryWorkflow = read(".github/workflows/sentry-harness.yml");

    expect(driftWorkflow).toContain("psql --version");
    expect(driftWorkflow).not.toContain("apt-get");
    const scoreJob = sentryWorkflow.match(/  score-errors:\n([\s\S]*?)\n  fix-error:/)?.[1];

    expect(scoreJob).toBeDefined();
    expect(scoreJob).not.toContain("Install dependencies");
    expect(sentryWorkflow).toContain("max-parallel: 2");
  });

  it("serializes bot updates and avoids duplicate Claude reviews", () => {
    const progressWorkflow = read(".github/workflows/progress.yml");
    const reviewWorkflow = read(".github/workflows/claude-code-review.yml");

    expect(progressWorkflow).toContain("pull-requests: write");
    expect(progressWorkflow).toContain("cancel-in-progress: true");
    expect(progressWorkflow).toContain("gh pr create");
    expect(progressWorkflow).toContain("gh pr merge");
    expect(reviewWorkflow).toContain("concurrency:");
    expect(reviewWorkflow).toContain("sentry-fix/");
  });

  it("keeps GitHub Actions dependencies updated weekly", () => {
    const config = read(".github/dependabot.yml");

    expect(config).toContain('package-ecosystem: "github-actions"');
    expect(config).toContain('interval: "weekly"');
  });
});
