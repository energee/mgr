import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_ACTION, agentWriteScopeInventory, auditWorkflowEgress } from "./workflow-egress";

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

// Derived, not hardcoded: the SHA-pinning and durable-outcome contracts below
// iterate this list, so a hand-maintained array silently exempts every workflow
// added after it was last updated — the two contracts that most need to cover
// new files were the two that wouldn't have.
const WORKFLOW_DIR = ".github/workflows";
const workflows = readdirSync(resolve(process.cwd(), WORKFLOW_DIR))
  .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
  .map((file) => `${WORKFLOW_DIR}/${file}`)
  .sort();

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

  // Issue #644: the E2E lane authenticates through /api/auth/dev-login, which
  // 404s unless explicitly enabled. The job serves a production `next build`
  // via `bun start` (NODE_ENV=production), and no E2E_USER_* credentials exist
  // for the throwaway local stack — so without this flag the `setup` project
  // times out and every authenticated spec fails. Pinned here so the lane
  // cannot silently go credential-less again.
  it("enables the dev-login route for the E2E lane and nowhere else", () => {
    const workflow = read(".github/workflows/test.yml");
    // `e2e` is the last job in the file; capture to EOF.
    const e2eJob = workflow.match(/\n  e2e:\n([\s\S]*)$/)?.[1];

    expect(e2eJob).toBeDefined();
    // Job-scoped, so it reaches both `bun run build` and the server Playwright
    // boots — a step-scoped flag on the wrong step is a silent no-op.
    expect(e2eJob).toMatch(/\n    env:\n(?:\s*#.*\n)*\s+E2E_DEV_LOGIN: "1"\n/);
    expect(e2eJob).toContain("bun e2e");

    // Trust boundary: dev-login mints an admin session with no credentials.
    // Enabling it anywhere but this ephemeral, throwaway-database job would
    // widen that to real environments.
    for (const path of workflows) {
      if (path === ".github/workflows/test.yml") continue;
      expect(read(path), `${path} must not enable E2E_DEV_LOGIN`).not.toContain("E2E_DEV_LOGIN");
    }
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
    // Guard the derivation itself: a bad cwd would make every loop below
    // vacuously pass.
    expect(workflows.length).toBeGreaterThanOrEqual(13);

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

    // The gate must stay at `high` or stricter. Only `critical` is a
    // downgrade — it reports strictly fewer advisories, which is the broad
    // severity suppression the policy prohibits. `moderate` and `low` report a
    // superset of `high`, so they are stricter, not suppression, and must not
    // be rejected here.
    expect(auditStep).not.toMatch(/--audit-level=critical/);
    // `--ignore` must always name a concrete advisory. A bare flag, or one
    // taking a severity/package name, would suppress far more than the
    // documented exception.
    for (const flag of auditStep!.matchAll(/--ignore(?:=|\s+)(\S+)/g)) {
      expect(flag[1]).toMatch(/^(GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}|CVE-\d{4}-\d+)$/);
    }
  });

  // An ignore with no dated record in the policy doc is exactly the
  // "undocumented ignore" the policy prohibits, and it is invisible in review
  // once the PR that added it scrolls out of sight. Pin the pairing so a
  // suppression cannot outlive its written justification.
  it("documents every suppressed advisory in the dependency policy", () => {
    const auditStep = read(".github/workflows/test.yml").match(
      /- name: Check for dependency vulnerabilities[\s\S]*?(?=\n\s+- name:|\n\s{2}[a-z-]+:|$)/,
    )?.[0];
    const policy = read("docs/security/dependency-policy.md");

    expect(auditStep).toBeDefined();
    const ignored = [...auditStep!.matchAll(/--ignore(?:=|\s+)(\S+)/g)].map((m) => m[1]);

    for (const advisory of ignored) {
      expect(policy).toContain(advisory);
      // Each record carries an expiry date, so a stale exception is auditable.
      expect(policy).toMatch(/Expiry\b/);
    }

    // Conversely: with no active exceptions the doc must say so, so "no
    // exceptions" is an asserted state rather than an absence of text.
    if (ignored.length === 0) {
      expect(policy).toContain("There are no active exceptions.");
    }
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

  // Egress contract (#645): every job that runs claude-code-action must deny
  // WebFetch and WebSearch. These jobs read attacker-influenceable text —
  // Sentry event payloads, fork-PR diffs, issue bodies — and most of them hold
  // a push-capable GITHUB_TOKEN, so a web tool is the one egress channel an
  // injected instruction can use with a single tool call and no shell work.
  // It is NOT the only channel (`Bash(git:*)` pushes to any remote,
  // `Bash(bun:*)` runs `bun -e 'fetch(...)'`, and `gh issue create` publishes
  // on a public repo) — see docs/agents/ci.md for what this does and does not
  // close. Denial must be explicit: a bare omission from --allowedTools is
  // invisible and gets "fixed" by the next author.
  //
  // The rule is unconditional rather than scoped to "credentialed" jobs
  // because the credential test was itself the bug — it counted only
  // contents/issues/pull-requests: write, so `actions: write` or a PAT in
  // `env:` skipped the check. A job that genuinely needs the network opts out
  // with a `web-egress: allowed (job: <name>) — <rationale>` marker, the same
  // escape hatch as `durable-state: exempt`, and every marker in the repo is
  // listed below so an opt-out can never be silent.
  it("denies web egress in every job that runs a generative Claude agent", () => {
    const generative = workflows.filter((path) => read(path).includes(AGENT_ACTION));

    // Guard the derivation: if the action reference is ever renamed, the audit
    // below must not start passing vacuously.
    expect(generative).toEqual(
      expect.arrayContaining([
        ".github/workflows/bug-patrol.yml",
        ".github/workflows/claude.yml",
        ".github/workflows/feedback-distill.yml",
        ".github/workflows/health-audit.yml",
        ".github/workflows/quality-regrade.yml",
        ".github/workflows/sentry-harness.yml",
      ]),
    );

    const audits = generative.map((path) => auditWorkflowEgress(path, read(path)));

    expect(audits.flatMap((audit) => audit.problems)).toEqual([]);

    // Opt-outs are enumerated, not counted: a new workflow whose agent job
    // stops being checked shows up here and fails, which a per-suite floor on
    // the number of checked jobs could not do (the known jobs already met it).
    // claude.yml is the one declared exemption — #661 gave that job a scoped
    // Bash allowlist that already reaches the network (Bash(bunx:*)), so
    // denying the web tools there would be posture, not protection; #669 owns
    // the decision. Any *second* entry here is a silent opt-out and fails.
    expect(audits.flatMap((audit) => audit.exemptions)).toEqual([
      expect.stringContaining(
        ".github/workflows/claude.yml (job: claude): interactive, insider-gated runs",
      ),
    ]);

    // Anti-vacuity backstop. auditWorkflowEgress already fails a file that
    // names the action but yields no agent job; this pins the repo-wide total
    // so a parser change that silently halves the inventory is caught too.
    expect(audits.flatMap((audit) => audit.jobs).length).toBeGreaterThanOrEqual(6);
  });

  // Credential contract (#668), the other half of #645. Denying the web tools
  // closes one channel; it cannot close egress for a job that can execute code,
  // and every one of these agents can (`Edit` plus `bun run test` or
  // `make check` is arbitrary code execution by construction). The remedy that
  // does work is to leave nothing in the agent's reach worth stealing, and two
  // separate mechanisms decide what is in reach:
  //
  //  1. The job's `permissions:` block, which scopes its `GITHUB_TOKEN`.
  //  2. Whether the agent step passes `github_token`. With no such input,
  //     claude-code-action exchanges an OIDC assertion for a Claude GitHub App
  //     token hardcoded to contents/pull_requests/issues: write
  //     (`src/github/token.ts`), assigns it to `process.env.GITHUB_TOKEN` and
  //     `GH_TOKEN` before the agent starts (`src/entrypoints/run.ts`), and
  //     configures git auth with it. That token ignores the `permissions:`
  //     block entirely — it is why this repo's bug-patrol PRs are authored by
  //     `app/claude` — and `persist-credentials: false` does nothing about it.
  //
  // So this is an enumerated inventory, not a pass/fail rule: four loops
  // legitimately still push from inside the agent, and `health-audit`'s
  // "read-only" audit job turns out to hold a write-capable app token despite
  // read-only `permissions:` (noted in docs/agents/ci.md, tracked separately).
  // Listing every one by exact credential means a job that gains either source
  // fails here, and `sentry-harness.yml`'s `fix-error` — which gave up both —
  // cannot silently take them back. `id-token: write` is not itself counted as
  // a repository write, but removing it is what makes the app-token path
  // unavailable. A PAT handed to a step via `env:` is not visible here; see
  // docs/agents/ci.md for that caveat.
  it("enumerates every generative agent job whose shell can read a push-capable token", () => {
    const generative = workflows.filter((path) => read(path).includes(AGENT_ACTION));
    const inventory = generative.flatMap((path) => agentWriteScopeInventory(path, read(path)));
    const app = "claude app token (contents, issues, pull-requests)";

    expect(inventory.sort()).toEqual([
      `.github/workflows/bug-patrol.yml (job: patrol): contents, pull-requests + ${app}`,
      `.github/workflows/claude.yml (job: claude): contents, issues, pull-requests + ${app}`,
      `.github/workflows/feedback-distill.yml (job: distill): contents, pull-requests + ${app}`,
      `.github/workflows/health-audit.yml (job: audit): ${app}`,
      `.github/workflows/quality-regrade.yml (job: regrade): contents, pull-requests + ${app}`,
    ]);
  });

  // Mutation checks on the inventory: undo either half of the Sentry fix and
  // the contract must go red. Without these the assertion above proves only
  // that today's files happen to match a hand-written array.
  it("goes red if the Sentry agent job regains a write scope", () => {
    const path = ".github/workflows/sentry-harness.yml";
    // Rewrite only inside the fix-error job: score-errors is `contents: read`
    // too, and a first-match replace would have mutated the wrong job and left
    // this check passing over an unchanged file.
    const [head, ...rest] = read(path).split("\n  fix-error:");
    expect(rest).toHaveLength(1);
    // Anchored on the indented scope line: the job's comment block quotes
    // "`contents: read`" in prose, and a looser match would rewrite that
    // instead and leave this check passing over an unchanged permissions block.
    const restored = `${head}\n  fix-error:${rest[0].replace(/\n      contents: read\n/, "\n      contents: write\n")}`;

    expect(restored).not.toEqual(read(path));
    expect(agentWriteScopeInventory(path, restored)).toEqual([
      `${path} (job: fix-error): contents`,
    ]);
  });

  it("goes red if the Sentry agent step stops binding its own token", () => {
    const path = ".github/workflows/sentry-harness.yml";
    const dropped = read(path).replace(/\n {10}github_token: .+\n/, "\n");

    expect(dropped).not.toEqual(read(path));
    expect(agentWriteScopeInventory(path, dropped)).toEqual([
      `${path} (job: fix-error): claude app token (contents, issues, pull-requests)`,
    ]);
  });

  it.each([
    { shape: "no permissions: block", permissions: "", expected: "inherited (no permissions: block)" },
    { shape: "write-all", permissions: "    permissions: write-all\n", expected: "write-all" },
    {
      shape: "a quoted scalar",
      permissions: '    permissions:\n      contents: "write"\n',
      expected: "contents",
    },
    {
      shape: "only actions/packages write",
      permissions: "    permissions:\n      actions: write\n      packages: write\n",
      expected: "actions, packages",
    },
    {
      shape: "id-token write alone (no repository write)",
      permissions: "    permissions:\n      contents: read\n      id-token: write\n",
      expected: null,
    },
  ])("reads an agent job's permissions written as $shape", ({ permissions, expected }) => {
    // `github_token` bound, so the app-token half is out of the way and this
    // case isolates the permissions parse.
    const contents = [
      "name: Synthetic",
      "on: [push]",
      "jobs:",
      "  agent:",
      "    runs-on: ubuntu-latest",
      permissions.replace(/\n$/, ""),
      "    steps:",
      `      - uses: ${AGENT_ACTION}@${"0".repeat(40)}`,
      "        with:",
      "          github_token: ${{ secrets.GITHUB_TOKEN }}",
      "",
    ]
      .filter((line) => line !== "")
      .join("\n");

    expect(agentWriteScopeInventory("synthetic.yml", contents)).toEqual(
      expected === null ? [] : [`synthetic.yml (job: agent): ${expected}`],
    );
  });

  it.each([
    { shape: "omits the input entirely", input: null, minted: true },
    { shape: "passes an empty string", input: '          github_token: ""', minted: true },
    { shape: "binds the job token", input: "          github_token: ${{ secrets.GITHUB_TOKEN }}", minted: false },
  ])("detects the app-token mint when the agent step $shape", ({ input, minted }) => {
    const contents = [
      "name: Synthetic",
      "on: [push]",
      "jobs:",
      "  agent:",
      "    runs-on: ubuntu-latest",
      "    permissions:",
      "      contents: read",
      "    steps:",
      `      - uses: ${AGENT_ACTION}@${"0".repeat(40)}`,
      ...(input === null ? [] : ["        with:", input]),
      "",
    ].join("\n");

    expect(agentWriteScopeInventory("synthetic.yml", contents)).toEqual(
      minted ? ["synthetic.yml (job: agent): claude app token (contents, issues, pull-requests)"] : [],
    );
  });

  // Mutation check: the assertions above only prove the real workflows are
  // currently compliant, which is also what a check that inspects nothing
  // reports. Remove whatever makes each real workflow pass — its denial, or its
  // exemption marker — and the audit must go red. This is the guarantee the
  // previous version lacked: its per-suite floor was satisfied by the known
  // jobs, so it could report success over a file it had silently skipped.
  it.each(
    workflows.filter((path) => read(path).includes(AGENT_ACTION)),
  )("%s goes red when its declaration is removed", (path) => {
    const original = read(path);
    expect(auditWorkflowEgress(path, original).problems).toEqual([]);

    const stripped = original
      .replace(/--disallowedTools\s+"[^"]*"/g, "")
      .replace(/web-egress:\s*allowed/g, "");
    expect(auditWorkflowEgress(path, stripped).problems.length).toBeGreaterThan(0);
  });

  // Every case below is a workflow shape that the first version of the egress
  // contract mishandled. Verified against that version before the rewrite: the
  // "previously skipped" shapes each produced zero checked jobs and zero
  // failures (the invariant passing while checking nothing), and the unquoted
  // denial failed with the misleading "passes no --disallowedTools". They live
  // here so the holes cannot silently reopen.
  describe("egress contract on synthetic workflows", () => {
    const DENIAL = `          claude_args: '--allowedTools "Read" --disallowedTools "WebFetch,WebSearch"'`;
    const WRITE = "    permissions:\n      contents: write";
    const NO_DENIAL = `          claude_args: '--allowedTools "Read"'`;

    function synthetic({
      jobKey = "  agent:",
      permissions = WRITE,
      args = DENIAL,
    }: {
      jobKey?: string;
      permissions?: string;
      args?: string;
    } = {}): string {
      return [
        "name: Synthetic",
        "on: [push]",
        "jobs:",
        jobKey,
        "    runs-on: ubuntu-latest",
        permissions,
        "    steps:",
        `      - uses: ${AGENT_ACTION}@${"0".repeat(40)}`,
        "        with:",
        args,
        "",
      ].join("\n");
    }

    // Hole 1 (quoted scalar) and hole 5 (scope gap): the old credential test
    // read these as "no write permission" and skipped the job entirely.
    it.each([
      { shape: 'a quoted scalar (contents: "write")', permissions: '    permissions:\n      contents: "write"' },
      { shape: "the write-all shorthand", permissions: "    permissions: write-all" },
      {
        shape: "only actions/packages write",
        permissions:
          "    permissions:\n      contents: read\n      actions: write\n      packages: write",
      },
      {
        shape: "read scopes plus a PAT injected via env",
        permissions:
          "    permissions:\n      contents: read\n    env:\n      GH_TOKEN: ${{ secrets.RELEASE_PAT }}",
      },
    ])("flags an undenied agent job whose permissions use $shape", ({ permissions }) => {
      const audit = auditWorkflowEgress("synthetic.yml", synthetic({ permissions, args: NO_DENIAL }));

      expect(audit.jobs).toEqual(["synthetic.yml (job: agent)"]);
      expect(audit.exemptions).toEqual([]);
      expect(audit.problems).toHaveLength(1);
      expect(audit.problems[0]).toContain("--disallowedTools must name WebFetch and WebSearch");
    });

    // Hole 2: the old line splitter required a bare `  name:` header, so a
    // trailing comment or anchor on the job key discarded the whole job body.
    it.each([
      { shape: "a trailing comment", jobKey: "  agent: # nightly" },
      { shape: "a YAML anchor", jobKey: "  agent: &nightly-agent" },
    ])("flags an undenied agent job whose key carries $shape", ({ jobKey }) => {
      const audit = auditWorkflowEgress("synthetic.yml", synthetic({ jobKey, args: NO_DENIAL }));

      expect(audit.jobs).toEqual(["synthetic.yml (job: agent)"]);
      expect(audit.problems).toHaveLength(1);
      expect(audit.problems[0]).toContain("--disallowedTools must name WebFetch and WebSearch");
    });

    // Hole 6 (false positive): the old matcher required double quotes around
    // the value, so these correct denials were reported as missing.
    it.each([
      { shape: "unquoted", args: "          claude_args: --disallowedTools WebFetch,WebSearch" },
      { shape: "single-quoted", args: `          claude_args: "--disallowedTools 'WebFetch,WebSearch'"` },
      { shape: "in equals form", args: "          claude_args: --disallowedTools=WebFetch,WebSearch" },
      { shape: "in kebab-case", args: `          claude_args: '--disallowed-tools "WebFetch,WebSearch"'` },
      {
        shape: "in a block scalar",
        args:
          '          claude_args: |\n            --max-turns 4\n            --allowedTools "Read"\n            --disallowedTools "WebFetch,WebSearch"',
      },
      {
        shape: "alongside a JSON schema containing quotes",
        args: `          claude_args: '--disallowedTools "WebFetch,WebSearch" --json-schema {"type":"object"}'`,
      },
    ])("accepts a denial written $shape", ({ args }) => {
      expect(auditWorkflowEgress("synthetic.yml", synthetic({ args })).problems).toEqual([]);
    });

    it("flags an agent step that passes no argument input at all", () => {
      const audit = auditWorkflowEgress(
        "synthetic.yml",
        synthetic({ args: `          prompt: "fix the failing test"` }),
      );

      expect(audit.problems).toHaveLength(1);
      expect(audit.problems[0]).toContain("passes no claude_args/allowed_tools/disallowed_tools");
    });

    // Prompt text must not be able to satisfy the contract: in some jobs the
    // prompt is built from attacker-influenceable input.
    it("does not let a denial quoted inside the prompt satisfy the contract", () => {
      const audit = auditWorkflowEgress(
        "synthetic.yml",
        synthetic({ args: `          prompt: 'run with --disallowedTools "WebFetch,WebSearch"'` }),
      );

      expect(audit.problems).toHaveLength(1);
      expect(audit.problems[0]).toContain("passes no claude_args/allowed_tools/disallowed_tools");
    });

    it("flags an allow-list that grants a web tool even when it is also denied", () => {
      const audit = auditWorkflowEgress(
        "synthetic.yml",
        synthetic({
          args: `          claude_args: '--allowedTools "Read,WebFetch" --disallowedTools "WebFetch,WebSearch"'`,
        }),
      );

      expect(audit.problems).toEqual(["synthetic.yml (job: agent): --allowedTools must not grant WebFetch"]);
    });

    it("checks every agent step in a multi-step job", () => {
      const contents = [
        "name: Synthetic",
        "on: [push]",
        "jobs:",
        "  agent:",
        "    steps:",
        `      - uses: ${AGENT_ACTION}@${"0".repeat(40)}`,
        "        with:",
        DENIAL,
        `      - uses: ${AGENT_ACTION}@${"0".repeat(40)}`,
        "        with:",
        NO_DENIAL,
        "",
      ].join("\n");

      const audit = auditWorkflowEgress("synthetic.yml", contents);

      expect(audit.problems).toHaveLength(1);
      expect(audit.problems[0]).toContain("agent step 2");
    });

    // Hole 3: a floor on the number of checked jobs cannot notice a NEW file
    // being skipped, because the known jobs already satisfy it. These two
    // cases are the replacement — the audit fails when a file that names the
    // action contributes no checked job.
    it("flags a workflow that names the action but parses to no agent job", () => {
      const contents = [
        "name: Synthetic",
        "on: [push]",
        "jobs:",
        "  note:",
        "    steps:",
        `      - run: echo ${AGENT_ACTION}`,
        "",
      ].join("\n");

      const audit = auditWorkflowEgress("synthetic.yml", contents);

      expect(audit.jobs).toEqual([]);
      expect(audit.problems).toHaveLength(1);
      expect(audit.problems[0]).toContain("no job parsed as running it");
    });

    it("flags unparseable YAML instead of silently checking nothing", () => {
      const audit = auditWorkflowEgress("synthetic.yml", "jobs:\n  agent: [1,\n");

      expect(audit.problems).toHaveLength(1);
      expect(audit.problems[0]).toContain("is not parseable YAML");
    });

    it("honours a job-scoped exemption marker that carries a rationale", () => {
      const contents = synthetic({
        jobKey:
          "  # web-egress: allowed (job: agent) — reads vendor changelogs; no write scope\n  agent:",
        permissions: "    permissions:\n      contents: read",
        args: NO_DENIAL,
      });

      const audit = auditWorkflowEgress("synthetic.yml", contents);

      expect(audit.problems).toEqual([]);
      expect(audit.exemptions).toEqual([
        "synthetic.yml (job: agent): reads vendor changelogs; no write scope",
      ]);
    });

    it.each([
      {
        shape: "names a different job",
        marker: "  # web-egress: allowed (job: other) — reads vendor changelogs here",
      },
      { shape: "carries no rationale", marker: "  # web-egress: allowed (job: agent) — see above" },
    ])("ignores an exemption marker that $shape", ({ marker }) => {
      const audit = auditWorkflowEgress(
        "synthetic.yml",
        synthetic({ jobKey: `${marker}\n  agent:`, args: NO_DENIAL }),
      );

      expect(audit.exemptions).toEqual([]);
      expect(audit.problems).toHaveLength(1);
    });
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

  // Deploy verification (issue #587): every merge to main auto-deploys to
  // Vercel production and nothing verified the deployed artifact — no smoke
  // check, no uptime probe. The probe that closes that gap must stay a cron
  // watchdog with ONE deduped issue, must reject a 200 that carries
  // "degraded" (status-code-only checks would call a dead database healthy),
  // must cover the auth wall, and must fail LOUDLY when PRODUCTION_URL is
  // unset — a health gate that silently passes when unconfigured is worse
  // than none, which is exactly how the secrets-gated E2E job never ran
  // (issue #437).
  it("probes production on a cron and fails loudly when PRODUCTION_URL is unset", () => {
    const workflow = read(".github/workflows/prod-health.yml");

    expect(workflow).toContain('cron: "*/15 * * * *"');
    expect(workflow).toContain("workflow_dispatch");
    expect(workflow).toContain("vars.PRODUCTION_URL");
    expect(workflow).toMatch(/::error::PRODUCTION_URL repository variable is not set/);
    expect(workflow).toContain("gh variable set PRODUCTION_URL");

    // Both surfaces, and a body assertion — not just the status code.
    expect(workflow).toContain("/api/health");
    expect(workflow).toContain("jq -r '.status // empty'");
    expect(workflow).toContain('!= "ok"');
    expect(workflow).toContain("/login");

    // Retry with backoff so one network blip does not open an issue.
    expect(workflow).toContain("max_attempts=3");

    // ONE deduped issue, mirroring live-drift.yml / nightly-watch.yml, and no
    // issue churn at all when the probe never produced a verdict.
    expect(workflow).toContain("gh label create");
    expect(workflow).toContain("prod-down");
    expect(workflow).toContain("gh issue create");
    expect(workflow).toContain("gh issue close");
    expect(workflow).toContain("steps.probe.outputs.healthy != ''");

    // Least privilege: issue writes only, and no checkout to leak a token into.
    expect(workflow).toMatch(/permissions:\n  issues: write/);
    expect(workflow).not.toContain("contents: write");
    expect(workflow).not.toContain("pull-requests:");
    expect(workflow).not.toContain("actions/checkout");
    expect(workflow).toContain("timeout-minutes:");
  });

  // Routing freshness: docs/agents/ci.md's workflow table went stale in the
  // same commit that added new workflows. Every workflow file must appear in
  // ci.md (forward ratchet; the table itself is the backward migration).
  it("keeps docs/agents/ci.md covering every workflow file", () => {
    const doc = read("docs/agents/ci.md");
    for (const path of workflows) {
      const file = path.slice(WORKFLOW_DIR.length + 1);
      expect(doc, `${file} is missing from docs/agents/ci.md`).toContain(file);
    }
  });
});
