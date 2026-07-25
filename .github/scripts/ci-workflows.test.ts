import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

const workflows = [
  ".github/workflows/bug-patrol.yml",
  ".github/workflows/claude.yml",
  ".github/workflows/db-lint.yml",
  ".github/workflows/feedback-distill.yml",
  ".github/workflows/health-audit.yml",
  ".github/workflows/hygiene.yml",
  ".github/workflows/live-drift.yml",
  ".github/workflows/nightly-watch.yml",
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

  // Public-repo contract (2026-07-24): static + unit run on EVERY PR —
  // including docs-only ones — so their contexts always report and can be
  // required status checks on main. Build + E2E stay on the weekday nightly
  // schedule (design note in test.yml's header).
  it("keeps the PR lane lean and defers build/E2E to the nightly schedule", () => {
    const workflow = read(".github/workflows/test.yml");

    expect(workflow).not.toContain("matrix:");
    expect(workflow).not.toContain("--shard=");
    expect(workflow).not.toContain("--merge-reports");
    expect(workflow).toContain("bunx vitest run --coverage");
    // No paths-ignore: required checks must report on docs-only PRs too.
    expect(workflow).not.toContain("paths-ignore:");
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
    // SHA-pinned (tag as trailing comment) per docs/security/dependency-policy.md.
    expect(dbWorkflow).toMatch(/supabase\/setup-cli@[0-9a-f]{40} # v3/);
    expect(dbWorkflow).toContain('version: "2.109.1"');
    expect(dbWorkflow).not.toContain("Lint shell scripts");
    expect(testWorkflow).not.toContain("Integration Tests (RLS)");
    expect(shellWorkflow).toContain("shellcheck");
    expect(shellWorkflow).not.toContain("postgres:");
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

  it("serializes bot updates to PROGRESS.md", () => {
    const progressWorkflow = read(".github/workflows/progress.yml");

    expect(progressWorkflow).toContain("pull-requests: write");
    expect(progressWorkflow).toContain("cancel-in-progress: true");
    expect(progressWorkflow).toContain("gh pr create");
    expect(progressWorkflow).toContain("gh pr merge");
    // Required-checks compatibility: the bot PR must run the required
    // checks ([skip ci] would suppress them) and wait for them via --auto.
    expect(progressWorkflow).not.toContain("[skip ci]");
    expect(progressWorkflow).toContain("--auto");
  });

  // Supply-chain contract (see docs/security/dependency-policy.md): every
  // action outside the high-trust `actions/` namespace must be pinned to a
  // full 40-hex commit SHA (tag recorded as a trailing comment). Dependabot
  // keeps the SHAs current.
  it("pins all non-actions/* actions to full commit SHAs", () => {
    for (const path of workflows) {
      const lines = read(path).split("\n");
      for (const line of lines) {
        const match = line.match(/^\s*(?:- )?uses:\s*(\S+)/);
        if (!match) continue;
        const [, ref] = match;
        // Repo-local composite actions (./.github/actions/*) are pinned by
        // the commit that references them — no SHA to record.
        if (ref.startsWith("actions/") || ref.startsWith("./")) continue;
        expect(ref, `${path}: ${ref} must be pinned to a 40-char commit SHA`).toMatch(
          /@[0-9a-f]{40}$/,
        );
      }
    }
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

  // Durable-outcome contract (2026-07-24): an agentic job that dies silently
  // (tool-permission denial, empty run) must go red, not green. Three loops
  // failed exactly this way — quality-regrade's 10 empty runs, sentry's
  // silent --allowed-tools denials, the never-running E2E job — so every
  // workflow that invokes claude-code-action must end in the
  // require-durable-outcome gate or carry an explicit `durable-state: exempt`
  // comment naming which deterministic step owns its outcome instead.
  it("ends every agentic workflow in a durable-outcome gate or an explicit exemption", () => {
    for (const path of workflows) {
      const contents = read(path);
      if (!contents.includes("claude-code-action")) continue;
      expect(
        contents,
        `${path} invokes claude-code-action but has neither the require-durable-outcome gate nor a durable-state: exempt rationale`,
      ).toMatch(/require-durable-outcome|durable-state: exempt/);
    }
  });

  // The rebuilt quality-regrade must never regress to its predecessor's
  // failure mode: no --allowedTools meant 10 green runs that produced nothing.
  it("rebuilds quality-regrade with the explicit allowlist its predecessor lacked", () => {
    const workflow = read(".github/workflows/quality-regrade.yml");

    expect(workflow).toContain("--allowedTools");
    expect(workflow).toContain("--model claude-sonnet-5");
    expect(workflow).toContain('cron: "0 6 * * 1"');
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("github.repository == 'energee/mgr'");
    expect(workflow).toContain("gh label create quality-regrade");
    expect(workflow).toContain("label: quality-regrade");
    expect(workflow).toContain("docs/agents/quality.md");
  });

  // The weekly distillation is the loop that gardens the other loops: it must
  // see deterministic acceptance data (loop-scoreboard), propose retirements
  // (not only additions), and make every promotion falsifiable.
  it("feeds deterministic scoreboard data and a retirement mandate into distillation", () => {
    const workflow = read(".github/workflows/feedback-distill.yml");

    expect(workflow).toContain("loop-scoreboard.ts");
    expect(workflow).toContain("Propose retirements");
    expect(workflow).toContain("recurrence signal");
    expect(workflow).toContain("quiet-run.md");
  });

  // Routing freshness: docs/agents/ci.md's workflow table went stale in the
  // same commit that added new workflows. Every workflow file must appear in
  // ci.md (forward ratchet; the table itself is the backward migration).
  it("keeps docs/agents/ci.md covering every workflow file", () => {
    const doc = read("docs/agents/ci.md");
    for (const file of readdirSync(resolve(process.cwd(), ".github/workflows"))) {
      expect(doc, `${file} is missing from docs/agents/ci.md`).toContain(file);
    }
  });
});
