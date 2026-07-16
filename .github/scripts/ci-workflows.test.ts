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
  ".github/workflows/health-audit.yml",
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
  });

  // Minutes-budget contract (2026-07-16): PRs run static + one unsharded
  // unit job only; build + E2E run on the weekday nightly schedule; docs-only
  // changes skip the workflow. See docs/progress/2026-07-16-ci-minutes-diet.md.
  it("keeps the PR lane lean and defers build/E2E to the nightly schedule", () => {
    const workflow = read(".github/workflows/test.yml");

    expect(workflow).not.toContain("matrix:");
    expect(workflow).not.toContain("--shard=");
    expect(workflow).not.toContain("--merge-reports");
    expect(workflow).toContain("bunx vitest run --coverage");
    expect(workflow).toContain("paths-ignore:");
    expect(workflow).toMatch(/build:[\s\S]*?if: github\.event_name == 'schedule' \|\| github\.event_name == 'workflow_dispatch'/);
    expect(workflow).not.toMatch(/\n  push:/);
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
    // PR-only, schema-relevant paths only — no push re-run, no dep-bump runs.
    expect(dbWorkflow).not.toMatch(/\n  push:/);
    expect(dbWorkflow).not.toMatch(/- "bun\.lock"/);
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
    // Minutes budget: one weekday run, and a hard ceiling on fix jobs.
    expect(sentryWorkflow).toContain('cron: "0 17 * * 1-5"');
    expect(sentryWorkflow).toContain("timeout-minutes: 45");
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
    // One review per PR: no synchronize re-reviews, docs-only PRs skipped.
    expect(reviewWorkflow).toMatch(/types: \[opened, ready_for_review\]/);
    expect(reviewWorkflow).toContain("paths-ignore:");
  });

  it("keeps GitHub Actions dependencies updated weekly", () => {
    const config = read(".github/dependabot.yml");

    expect(config).toContain('package-ecosystem: "github-actions"');
    expect(config).toContain('interval: "weekly"');
  });

  it("blocks unexcepted high-severity dependency advisories", () => {
    const workflow = read(".github/workflows/test.yml");
    const auditStep = workflow.match(
      /- name: Check for dependency vulnerabilities[\s\S]*?(?=\n\s+- name:|\n\s{2}[a-z-]+:|$)/,
    )?.[0];

    expect(auditStep).toBeDefined();
    expect(auditStep).toContain("bun audit --audit-level=high");
    expect(auditStep).not.toContain("continue-on-error");
    expect(auditStep).toContain("docs/security/dependency-policy.md");
  });

  it("keeps scheduled health analysis read-only and isolates issue writes in the publisher", () => {
    const workflow = read(".github/workflows/health-audit.yml");
    const auditJob = workflow.match(/  audit:\n([\s\S]*?)\n  publish:/)?.[1];
    const publishJob = workflow.match(/  publish:\n([\s\S]*)/)?.[1];

    expect(auditJob).toBeDefined();
    expect(auditJob).toContain("contents: read");
    expect(auditJob).toContain("issues: read");
    expect(auditJob).not.toContain("issues: write");
    expect(auditJob).toContain("fetch-depth: 0");
    expect(auditJob).not.toContain("needs.audit.outputs.audit_sha");
    expect(auditJob).toContain("--json-schema");
    expect(auditJob).toContain("--disallowedTools");
    expect(auditJob).toContain("Edit,Write");
    expect(auditJob).toContain("steps.audit.outputs.structured_output");

    expect(publishJob).toBeDefined();
    expect(publishJob).toContain("contents: read");
    expect(publishJob).toContain("issues: write");
    expect(publishJob).toContain("ref: ${{ needs.audit.outputs.audit_sha }}");
    expect(publishJob).toContain("publish-health-audit.ts");
    expect(publishJob).toContain("CREATE_ISSUES:");
    expect(publishJob).toContain("AUDIT_FOCUS:");

    expect(workflow).toContain('cron: "37 13 * * 3"');
    expect(workflow).toMatch(/create_issues:\n[\s\S]*?default: false/);
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).not.toContain('show_full_output: "true"');
  });
});
