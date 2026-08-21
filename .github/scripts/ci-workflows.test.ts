import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGENT_ACTION,
  agentWriteScopeInventory,
  auditWorkflowEgress,
  readOnlyMintContradictions,
  unscopedGhApiGrants,
} from "./workflow-egress";
import { EXECUTED_TEST_DIRS, fixBranch, SENTRY_TEST_FILE_RE } from "./sentry-harness/outbox";

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

/**
 * Split a workflow's `jobs:` mapping into one text block per job, so a
 * contract can follow a `needs:` edge instead of pattern-matching the whole
 * file. Text, not parsed YAML, because every other contract here reads text
 * and the job-level assertions are all about literal indentation (a 4-space
 * `if:` is job-level; an 8-space one belongs to a step).
 *
 * Comment lines that sit between two jobs land in the earlier job's block.
 * That is harmless as long as callers checking for a key strip comments first
 * — hence `uncommented` below.
 */
function jobBlocks(workflow: string): Map<string, string> {
  const blocks = new Map<string, string>();
  let current: string | null = null;
  let buffer: string[] = [];
  let inJobs = false;

  for (const line of workflow.split("\n")) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;

    const header = line.match(/^ {2}([A-Za-z][\w-]*):\s*$/);
    if (header) {
      if (current) blocks.set(current, buffer.join("\n"));
      current = header[1];
      buffer = [];
      continue;
    }
    if (current) buffer.push(line);
  }
  if (current) blocks.set(current, buffer.join("\n"));

  return blocks;
}

/**
 * Drop comment-only lines. EVERY assertion about what a job *does* has to go
 * through this: a comment can restate a guard's error message verbatim, so a
 * contract that matches the raw block is satisfied by prose that survives the
 * deletion of the code it describes. That is the same defect this file's E2E
 * contracts exist to catch, one level up.
 */
function uncommented(block: string, marker: "#" | "//" = "#"): string {
  const commentStart = marker === "#" ? /^\s*#/ : /^\s*\/\//;
  return block
    .split("\n")
    .filter((line) => !commentStart.test(line))
    .join("\n");
}

/**
 * The jobs named by a job's `needs:`, in either YAML form (`needs: a` /
 * `needs: [a, b]` / a block sequence). Comments are stripped first so a
 * commented-out `needs:` is not read as a real edge.
 */
function declaredNeeds(block: string): string[] {
  const lines = uncommented(block).split("\n");
  const at = lines.findIndex((line) => /^ {4}needs:/.test(line));
  if (at < 0) return [];

  const inline = lines[at].replace(/^ {4}needs:\s*/, "").trim();
  if (inline !== "") {
    return inline
      .replace(/[[\]]/g, "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
  }

  const sequence: string[] = [];
  for (const line of lines.slice(at + 1)) {
    const item = line.match(/^ {6}-\s*(.+?)\s*$/);
    if (!item) break;
    sequence.push(item[1]);
  }
  return sequence;
}

/**
 * Every job reachable from `start` through `needs:`, TRANSITIVELY. Direct
 * dependencies are not enough: `e2e -> unit-tests -> static` means an `if:`
 * two edges away still skips e2e on every pull request, and a skipped job
 * reads as green. Cycle-safe (GitHub rejects cycles, but a contract that
 * hangs is worse than one that reds).
 */
function transitiveNeeds(jobs: Map<string, string>, start: string): string[] {
  const seen = new Set<string>([start]);
  const queue = [start];
  const reached: string[] = [];

  while (queue.length > 0) {
    const block = jobs.get(queue.shift()!);
    if (block === undefined) continue;
    for (const dep of declaredNeeds(block)) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      reached.push(dep);
      queue.push(dep);
    }
  }
  return reached;
}

/**
 * Assert an `::error::` annotation is backed by an executable guard: the
 * message must appear on a non-comment line and an `exit 1` must follow it
 * within a few lines. Matching the message alone would let someone delete the
 * `case`/`if` that raises it and leave the sentence behind — a contract that
 * passes when the thing it pins is gone.
 */
function expectFailsLoudly(jobCode: string, marker: RegExp, guarded: string): void {
  const lines = jobCode.split("\n");
  const at = lines.findIndex((line) => marker.test(line));
  expect(at, `no live \`::error::\` line for ${guarded} (matching ${marker}); a comment does not count`).toBeGreaterThanOrEqual(0);
  expect(
    lines.slice(at + 1, at + 6).join("\n"),
    `the \`::error::\` for ${guarded} is not followed by \`exit 1\` — an annotation without a non-zero exit still reports a green check`,
  ).toMatch(/^\s*exit 1\s*$/m);
}

/**
 * Enabled (non-`test.skip`) cases under `e2e/*.spec.ts`. The E2E job's
 * anti-vacuity floor is checked against this so it cannot drift into
 * meaninglessness while the suite shrinks around it.
 */
function enabledE2eTests(): number {
  return readdirSync(resolve(process.cwd(), "e2e"))
    .filter((file) => file.endsWith(".spec.ts"))
    .flatMap((file) => read(`e2e/${file}`).split("\n"))
    .filter((line) => /^\s*test\(/.test(line)).length;
}

describe("GitHub Actions performance contracts", () => {
  it("uses the current checkout and artifact action generations", () => {
    const contents = workflows.map(read).join("\n");

    expect(contents).not.toContain("actions/checkout@v4");
    expect(contents).not.toContain("actions/upload-artifact@v4");
    expect(contents).toContain("actions/checkout@v7");
    expect(contents).toContain("actions/upload-artifact@v7");
  });

  // Public-repo contract (2026-07-24): static, unit and E2E run on EVERY PR —
  // including docs-only ones — so their contexts always report, which is the
  // precondition for making them required status checks on main — which they
  // became on 2026-08-12 (#713): ruleset 11725742 now declares a
  // `required_status_checks` rule naming Static Checks, Unit Tests, E2E Tests
  // and Database Lint and Integration Tests. Only the hosted-credential build
  // stays on the weekday nightly schedule (design note in test.yml's header).
  it("keeps the PR lane unsharded and defers only the hosted build to the nightly schedule", () => {
    const workflow = read(".github/workflows/test.yml");

    expect(workflow).not.toContain("matrix:");
    expect(workflow).not.toContain("--shard=");
    expect(workflow).not.toContain("--merge-reports");
    expect(workflow).toContain("bunx vitest run --coverage");
    // The codegraph extractor eval's deterministic passes run on every PR;
    // the LLM cases stay local-only (CI has no codex subscription).
    expect(workflow).toContain("bun tools/codegraph/eval.ts --ast");
    expect(workflow).toContain("bun tools/codegraph/eval.ts --sql");
    // No paths-ignore: an always-report check has to report on docs-only PRs
    // too. ("Always-report", not "required" — none of these is a required
    // status check today; see the note above this `it`.)
    expect(workflow).not.toContain("paths-ignore:");
    expect(workflow).toMatch(/build:[\s\S]*?if: github\.event_name == 'schedule' \|\| github\.event_name == 'workflow_dispatch'/);
    expect(workflow).not.toMatch(/\n  push:/);
    expect(workflow).toContain(".next/cache");
    expect(workflow).toContain(".eslintcache");
    expect(workflow).toContain("tsconfig.tsbuildinfo");
    expect(workflow).toContain("make check-db");
    expect(workflow).toContain("make check-wip");
    // #654: the deployment-record gate is only worth having if it runs on
    // every PR. `make check` includes it locally; this pins it in CI too.
    expect(workflow).toContain("make check-deploy-state");
    expect(workflow).toContain("make check-agent-config");
    expect(workflows.map(read).join("\n")).not.toContain("cache: true");
  });

  // Half of acceptance criterion 1 of issue #437 — the half a workflow file
  // can own: E2E has to RUN and REPORT on pull requests. (The other half,
  // making the context required, is a repository-settings change; see
  // docs/agents/ci.md. Nothing here should be read as a claim that it is.)
  //
  // This is exactly the kind of change nobody notices in review: PR #506 was
  // written as a per-PR Playwright gate but merged 14 minutes after #522's
  // CI-minutes diet, in nightly form, so on main the job carried
  // `if: schedule || workflow_dispatch` from the day it first existed and had
  // never once run on a pull_request event. Minutes are free on a public repo
  // since 2026-07-24, so it moved onto the PR lane — and is pinned here,
  // because GitHub reports a job that never ran as "skipped" and a skipped
  // check reads as green wherever conclusions are consumed. Every route to
  // "did not run" is therefore a route to a green check that tested nothing.
  it("runs the E2E gate on pull requests and never lets it skip into green", () => {
    const workflow = read(".github/workflows/test.yml");
    const jobs = jobBlocks(workflow);
    const e2e = jobs.get("e2e");

    expect(e2e).toBeDefined();

    // Key order within `on:` is behaviour-neutral in YAML, so pin membership,
    // not position — a contract that reds on a harmless reorder gets deleted.
    const onBlock = workflow.match(/^on:\n([\s\S]*?)\n(?=\S)/m)?.[1] ?? "";
    expect(onBlock).not.toBe("");
    expect(onBlock, "test.yml must trigger on pull_request").toMatch(/^ {2}pull_request:/m);

    // Route 1: a path filter. "Only PRs touching relevant paths" reports green
    // on every PR it declines to run for, which is the same defect renamed.
    // Comments are stripped so prose about paths cannot red this.
    expect(
      uncommented(onBlock),
      "no path filter on the trigger — a filtered-out PR still reports green",
    ).not.toMatch(/^\s*paths(-ignore)?:/m);

    // Route 2: any `needs:` edge at all on the e2e job. A dependency that is
    // skipped, RED or cancelled skips this job, and a skip reads as green —
    // so an ungated dependency is not enough, the edge itself is the hazard.
    // Measured, not hypothetical: on main, `Static Checks` failed on the
    // 2026-07-20..24 nightlies and `Production Build` failed on 2026-07-27..30,
    // and `E2E Tests` reported "skipped" on every one of those runs. The job
    // consumes nothing from any other job — it re-checks out, re-installs,
    // boots its own Supabase and runs its own `bun run build`.
    expect(
      declaredNeeds(e2e!),
      "the e2e job must declare no `needs:` — a skipped, failed or cancelled dependency skips it, and a skipped check reads as green",
    ).toEqual([]);

    // Route 3: an event gate, on the job or anywhere in its needs graph.
    // Checked TRANSITIVELY and for every job whose check reports on a PR: an
    // `if:` on `static` would skip `unit-tests`, which would skip anything
    // downstream of it, two edges from where the gate was written.
    for (const job of ["static", "unit-tests", "e2e"]) {
      const block = jobs.get(job);
      expect(block, `test.yml declares no job named "${job}"`).toBeDefined();
      expect(
        uncommented(block!),
        `the ${job} job must carry no job-level \`if:\` — an event gate is how the E2E check silently stopped running on pull requests`,
      ).not.toMatch(/^ {4}if:/m);

      for (const dep of transitiveNeeds(jobs, job)) {
        const depBlock = jobs.get(dep);
        expect(depBlock, `test.yml declares no job named "${dep}"`).toBeDefined();
        expect(
          uncommented(depBlock!),
          `${job} depends (transitively) on "${dep}", which is event-gated: a dependency that does not run skips its dependents, and a skipped check reports as passing`,
        ).not.toMatch(/^ {4}if:/m);
      }
    }

    // Route 4: the same gate one indentation level down. Everything above
    // guards the JOB; an `if:` or `continue-on-error:` on an individual STEP
    // leaves the job reporting success on a pull request while the step that
    // proves anything never ran. Measured against this suite before it was
    // pinned: `if: github.event_name == 'schedule'` on the "Run E2E tests"
    // step, the same on "Assert the browser suite actually ran", and
    // `continue-on-error: true` on the assert step ALL left the contract green
    // at 64/64. Step keys sit at 8 spaces, job keys at 4.
    // Not a blanket ban: `always()` / `!cancelled()` / `failure()` make a step
    // run MORE often, never less, and the job needs them for artifact upload
    // and teardown. What must not appear is a condition that can evaluate
    // false on a pull request — an event gate, a ref test, an input check.
    const ALWAYS_RUNS = /^\$\{\{\s*(always\(\)|!\s*cancelled\(\)|failure\(\)|success\(\)\s*\|\|\s*failure\(\))\s*\}\}$|^(always\(\)|!\s*cancelled\(\)|failure\(\))$/;
    const e2eCode = uncommented(e2e!);
    const stepConditions = [...e2eCode.matchAll(/^ {8}if:\s*(.+?)\s*$/gm)].map((m) => m[1]);
    for (const cond of stepConditions) {
      expect(
        cond,
        `step-level \`if: ${cond}\` in the e2e job can evaluate false on a pull request, which lets the job report success without that step having run. Only always()/!cancelled()/failure() are allowed here — they widen when a step runs, never narrow it`,
      ).toMatch(ALWAYS_RUNS);
    }
    expect(
      e2eCode,
      "no step in the e2e job may carry `continue-on-error:` — a guard whose failure does not fail the job is not a guard",
    ).not.toMatch(/^ {8}continue-on-error:/m);
  });

  // Acceptance criterion 2 of #437: missing E2E configuration must fail
  // visibly rather than yield an apparently healthy gate. Three concrete ways
  // this lane could look green while proving nothing, each closed by a step
  // that exits 1 with an ::error:: annotation — the same rule prod-health.yml
  // follows for an unset PRODUCTION_URL.
  //
  // Everything below reads the job with comments stripped, and every guard is
  // pinned as `::error::` + `exit 1` rather than as a message. A contract that
  // matched the raw text would be satisfied by deleting the guard and leaving
  // its sentence behind — which is this lane's own thesis ("a check that
  // passes when unconfigured is worse than no check") turned on itself.
  it("fails the E2E lane loudly when its stack is unconfigured or its run is vacuous", () => {
    const e2e = jobBlocks(read(".github/workflows/test.yml")).get("e2e");

    expect(e2e).toBeDefined();
    const code = uncommented(e2e!);

    // 1. No local Supabase credentials. `bun run build` sets
    //    SKIP_ENV_VALIDATION=1, so an empty (but set) NEXT_PUBLIC_SUPABASE_URL
    //    compiles fine and only surfaces as opaque Playwright timeouts.
    expectFailsLoudly(code, /::error::.*supabase status -o env/, "missing local Supabase credentials");

    // 2. A non-loopback Supabase URL: /api/auth/dev-login stays 404 on the
    //    E2E_DEV_LOGIN path (#656), so nothing can authenticate. The guard is
    //    a `case` over the exported URL; pin the branch, not just the message.
    expect(code, "the loopback check must be a live `case` over $API_URL").toMatch(/case "\$API_URL" in[\s\S]*?esac/);
    expectFailsLoudly(code, /::error::.*loopback hostname/, "a non-loopback Supabase URL");

    // 3. A run where everything skipped — Playwright exits 0 for that.
    expect(code).toContain("PLAYWRIGHT_JSON_OUTPUT_NAME");
    expect(code).toContain("--reporter=html,json");
    expect(code).toContain(".stats.expected");
    expect(code).toContain("E2E_MIN_PASSING");
    expectFailsLoudly(code, /::error::.*E2E test\(s\) passed/, "a vacuous (all-skipped) Playwright run");

    // Pin the COMPARISON, not just the tokens around it. Measured: rewriting
    // the test to `[ "$passed" -lt 0 ]` left every assertion above satisfied —
    // `E2E_MIN_PASSING: "16"`, `.stats.expected`, the `::error::` and its
    // `exit 1` were all still present — while the tripwire could never fire.
    // Pinning the annotation but not the condition is the same "matched the
    // text, not the behaviour" defect this block's own header warns about.
    expect(
      code,
      "the vacuity floor must actually compare the passing count against $E2E_MIN_PASSING — pinning the message while the condition compares a literal is a tripwire that cannot fire",
    ).toMatch(/-lt\s+"?\$\{?E2E_MIN_PASSING\}?"?/);

    // The floor must be a real one: 0 would accept an all-skipped run, and a
    // floor far below the suite would accept most of it going away. Ratchet it
    // to the enabled cases (17 today + the auth setup project = the 18 that
    // pass), with 2 of slack for pruning a scaffold. Adding tests should raise
    // the floor in the same commit; that is the point of the upper bound.
    const floor = Number(code.match(/E2E_MIN_PASSING: "(\d+)"/)?.[1]);
    const enabled = enabledE2eTests();
    expect(floor).toBeGreaterThan(0);
    expect(
      floor,
      `E2E_MIN_PASSING is ${floor} against ${enabled} enabled test(s) under e2e/ — a floor that far below the suite lets most of it be skipped while the gate stays green`,
    ).toBeGreaterThanOrEqual(enabled - 2);
    expect(
      floor,
      `E2E_MIN_PASSING is ${floor} but only ${enabled} spec test(s) plus the auth setup can pass — an unreachable floor reds the lane for everyone`,
    ).toBeLessThanOrEqual(enabled + 1);
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

    // Issue #679: DEV_LOGIN_ALLOW_REMOTE_DB lets dev-login mint admin against a
    // NON-loopback project. It is a per-developer opt-in for a local dev server
    // and has no legitimate use in CI — the e2e lane runs its own local stack,
    // which is loopback already. No workflow may set it, this one included.
    for (const path of workflows) {
      expect(
        read(path),
        `${path} must not set DEV_LOGIN_ALLOW_REMOTE_DB`,
      ).not.toContain("DEV_LOGIN_ALLOW_REMOTE_DB");
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
    // The integration suite is excluded from `make check` (it needs a live
    // Postgres — see vitest.config.ts), so db-lint is the ONLY gate that runs
    // it. Since #713 it runs on EVERY pull request, with no `paths:` filter:
    // `Database Lint and Integration Tests` is a REQUIRED status check on
    // `main`, and GitHub never queues a workflow whose `paths:` filter excludes
    // the PR — the context would stay pending forever and a docs-only PR could
    // never merge.
    //
    // Running it everywhere is affordable because it is not the critical path.
    // Measured on PR #790 (2026-08-12): this workflow ~3m13s (the Docker-backed
    // replay is its long pole) against `E2E Tests` at ~5m50s on every PR
    // regardless. Actions minutes are free on this public repo.
    //
    // An earlier attempt kept the filter and wrapped it in an always-reporting
    // gate job. It was discarded, but the bug it surfaced is worth recording:
    // translating `on: paths:` globs into git pathspecs is not copying. In a
    // pathspec `*` matches `/`, but `**/` still demands at least one directory,
    // so `supabase/migrations/**/*.sql` matched `.../sub/deep.sql` and NOT
    // `.../00250_x.sql`. Every migration here is top-level, so it selected
    // nothing real and every migration PR would have reported this check green.
    // Deleting the filter removes that whole class of failure.
    const dbOnBlock = uncommented(dbWorkflow.match(/^on:\n([\s\S]*?)\n(?=\S)/m)?.[1] ?? "");
    expect(dbOnBlock, "db-lint.yml must have an `on:` block").not.toBe("");
    expect(dbOnBlock, "db-lint.yml must trigger on pull_request").toMatch(/^ {2}pull_request:/m);
    expect(
      dbOnBlock,
      "db-lint.yml must carry no `paths:` filter — its job name is a required context, and a filtered-out PR never reports one",
    ).not.toMatch(/^\s*paths(-ignore)?:/m);

    // SHA-pinned (tag as trailing comment) per docs/security/dependency-policy.md.
    expect(dbWorkflow).toMatch(/supabase\/setup-cli@[0-9a-f]{40} # v3/);
    expect(dbWorkflow).toContain('version: "2.109.1"');
    expect(dbWorkflow).not.toContain("Lint shell scripts");
    expect(testWorkflow).not.toContain("Integration Tests (RLS)");
    expect(shellWorkflow).toContain("shellcheck");
    expect(shellWorkflow).not.toContain("postgres:");
    // Pin shell-lint's trigger paths for the same reason db-lint's are pinned
    // above, and because docs/agents/ci.md's rule 8 names both as deliberately
    // path-filtered opt-in lanes: the carve-out is only defensible while the
    // filter is the intended one, not an accident nobody would notice losing.
    expect(shellWorkflow, "shell-lint must run on script changes").toContain(
      '- "scripts/**"',
    );
  });

  // #713: `Database Lint and Integration Tests` is a REQUIRED status check on
  // `main`. A required context has exactly two ways to go wrong:
  //
  //   1. It never reports — the PR is unmergeable forever. Caused by filtering
  //      the workflow out of a run, or by letting the job skip.
  //   2. It reports green over checks that did not run or did not pass. That is
  //      strictly worse than no gate, because it is a gate everyone believes.
  //
  // Option 2 of #713 makes both structurally impossible rather than handled:
  // the job runs unconditionally on every PR and reports its own result, so
  // there is no filter to mistranslate and no skip to convert.
  it("keeps the required database context unfiltered, unskippable and self-reporting", () => {
    const workflow = read(".github/workflows/db-lint.yml");
    const jobs = jobBlocks(workflow);
    const REQUIRED_CONTEXT = "Database Lint and Integration Tests";

    // Exactly one job carries the required name. GitHub matches required
    // contexts by exact job name, so two would make it ambiguous which one
    // satisfies the rule.
    const named = [...jobs.entries()].filter(([, block]) =>
      new RegExp(`^ {4}name: ${REQUIRED_CONTEXT}\\s*$`, "m").test(uncommented(block)),
    );
    expect(
      named.map(([id]) => id),
      `exactly one job in db-lint.yml must be named "${REQUIRED_CONTEXT}"`,
    ).toEqual(["db-lint"]);

    const required = uncommented(jobs.get("db-lint")!);

    // It must be unconditional. Any job-level `if:` can evaluate false, and a
    // job that does not run reports nothing at all.
    expect(
      required.match(/^ {4}if:\s*(.+?)\s*$/m)?.[1],
      "the required job must carry no job-level `if:` — anything conditional can fail to report",
    ).toBeUndefined();

    // It must not depend on anything that can skip: a skipped dependency skips
    // the dependent, which is failure mode 1 by another route.
    expect(
      declaredNeeds(jobs.get("db-lint")!),
      "the required job must not wait on another job — a skipped dependency would skip it too",
    ).toEqual([]);

    // Its own exit code IS the check, so nothing may swallow a failure.
    expect(
      required,
      "no step in the required job may carry `continue-on-error:`",
    ).not.toMatch(/^ {8}continue-on-error:/m);

    // The lint step must still fail loudly rather than only printing a report.
    expectFailsLoudly(required, /::error::Database security lint failed/, "an ERROR-level lint finding");

    // `Production Build` must never join the required set: it is schedule-gated
    // in test.yml, so requiring it would leave every PR pending — the exact
    // failure this whole test exists to prevent, in the other workflow.
    const testWorkflow = read(".github/workflows/test.yml");
    const build = uncommented(jobBlocks(testWorkflow).get("build")!);
    expect(
      build,
      "Production Build must stay schedule-gated, and must therefore stay OUT of the required contexts",
    ).toMatch(/^ {4}if: github\.event_name == 'schedule'/m);
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
    // Check compatibility: the bot PR must run the PR checks ([skip ci] would
    // suppress them) and wait for them via --auto. Since #713 the four
    // contexts ARE required on `main` (ruleset 11725742), so --auto does wait.
    expect(progressWorkflow).not.toContain("[skip ci]");
    expect(progressWorkflow).toContain("--auto");

    // #844: a PR authored (or later synchronized) with `secrets.GITHUB_TOKEN`
    // triggers no workflows, so the required contexts never report and --auto
    // waits forever (bot PRs #836/#837). The job must mint an app installation
    // token and use it for BOTH the branch push (checkout token) and the
    // gh pr create/merge step; `secrets.GITHUB_TOKEN` may appear only as the
    // explicit fallback for when the app secrets are not configured.
    expect(progressWorkflow).toContain("actions/create-github-app-token@");
    expect(progressWorkflow).toContain(
      "token: ${{ steps.bot-token.outputs.token || github.token }}",
    );
    expect(progressWorkflow).toContain(
      "GH_TOKEN: ${{ steps.bot-token.outputs.token || secrets.GITHUB_TOKEN }}",
    );
    expect(progressWorkflow).not.toContain("GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}");

    // enablePullRequestAutoMerge races the PR's own checks starting up and
    // intermittently answers "unstable status" (~1/3 of runs, e.g. run
    // 31555267032, which left bot PR #805 stranded open) — the merge must be
    // retried, not failed on the first attempt.
    expect(progressWorkflow).toMatch(/for attempt in[\s\S]*gh pr merge/);
  });

  // #796: the committed graph.json must be kept fresh by automation — the
  // refresh bot mirrors progress.yml (bot PR + retried auto-merge), rebuilds
  // ONLY the deterministic passes, and its trigger paths must include the
  // extractor code itself so an EXTRACTOR_VERSION bump refreshes the artifact.
  it("refreshes the committed codegraph through an auto-merged bot PR", () => {
    const workflow = read(".github/workflows/codegraph-refresh.yml");

    expect(workflow).toContain("pull-requests: write");
    expect(workflow).toContain("tools/codegraph/build.ts");
    expect(workflow).toContain("gh pr create");
    expect(workflow).toContain("gh pr merge");
    expect(workflow).toMatch(/for attempt in[\s\S]*gh pr merge/);
    expect(workflow).toContain('- "tools/codegraph/**"');
    expect(workflow).toContain('- "docs/feature_list.json"');
    expect(workflow).not.toContain("[skip ci]");
    // Deterministic only: the refresh job must never invoke the LLM pass.
    expect(workflow).not.toContain("--llm");
    // #844: same credential contract as progress.yml — app token for push and
    // PR, GITHUB_TOKEN only as explicit fallback.
    expect(workflow).toContain("actions/create-github-app-token@");
    expect(workflow).toContain("token: ${{ steps.bot-token.outputs.token || github.token }}");
    expect(workflow).toContain(
      "GH_TOKEN: ${{ steps.bot-token.outputs.token || secrets.GITHUB_TOKEN }}",
    );
    expect(workflow).not.toContain("GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}");
  });

  // The doctor ratchet runs inside the required Static Checks job: it must
  // rebuild the graph for the PR's own tree first (the committed graph.json
  // can lag), and it must run strict so unallowlisted findings go red.
  it("runs the codegraph doctor strictly in Static Checks", () => {
    const workflow = read(".github/workflows/test.yml");
    expect(workflow).toMatch(/build\.ts\n\s+bun tools\/codegraph\/doctor\.ts --strict/);
  });

  // The pack step must never name a gitignored path inside an `:(exclude)`
  // pathspec on `git add`: git treats that as an explicit add of an ignored
  // path and exits 1 ("paths are ignored by one of your .gitignore files:
  // outbox"), which silently discarded real classification-(A) patches on
  // most scheduled runs after the credential split (docs/agents/ci.md).
  // /outbox/ and /sentry-outcome.md are gitignored, so a plain `git add -A`
  // already skips them.
  it("packs the sentry outbox without excluding ignored paths on git add", () => {
    const sentryWorkflow = read(".github/workflows/sentry-harness.yml");
    expect(sentryWorkflow).not.toMatch(/git add[^\n]*:\(exclude\)/);
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
    // Anchored on the indented scope line rather than matched as a substring:
    // the job's comment block quotes "contents/pull_requests/issues: write" in
    // prose to explain the app-token path it now avoids (#689), and a loose
    // `not.toContain("issues: write")` reads that sentence as a granted scope.
    // Same trap #700 found in the sentry mutation check.
    expect(auditJob).toMatch(/\n {6}contents: read\n/);
    expect(auditJob).toMatch(/\n {6}issues: read\n/);
    expect(auditJob).not.toMatch(/\n {6}issues: write\n/);
    // #689: the two halves that keep the agent's own shell read-only.
    expect(auditJob).not.toMatch(/\n {6}id-token: write\n/);
    expect(auditJob).toMatch(/\n {10}github_token: \$\{\{ secrets\.GITHUB_TOKEN \}\}\n/);
    expect(auditJob).toContain("fetch-depth: 0");
    expect(auditJob).not.toContain("needs.audit.outputs.audit_sha");
    expect(auditJob).toContain("--json-schema");
    expect(auditJob).toContain("--disallowedTools");
    expect(auditJob).toContain("Edit,Write");
    expect(auditJob).toContain("steps.audit.outputs.structured_output");

    expect(publishJob).toBeDefined();
    expect(publishJob).toMatch(/\n {6}contents: read\n/);
    expect(publishJob).toMatch(/\n {6}issues: write\n/);
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
  // legitimately still push from inside the agent. Listing every one by exact
  // credential means a job that gains either source fails here, and the two
  // that gave both up — `sentry-harness.yml`'s `fix-error` (#668) and
  // `health-audit.yml`'s `audit` (#689) — cannot silently take them back.
  // `id-token: write` is not itself counted as a repository write, but
  // removing it is what makes the app-token path unavailable. A PAT handed to
  // a step via `env:` is not visible here; see docs/agents/ci.md for that
  // caveat.
  it("enumerates every generative agent job whose shell can read a push-capable token", () => {
    const generative = workflows.filter((path) => read(path).includes(AGENT_ACTION));
    const inventory = generative.flatMap((path) => agentWriteScopeInventory(path, read(path)));
    const app = "claude app token (contents, issues, pull-requests)";

    expect(inventory.sort()).toEqual([
      `.github/workflows/bug-patrol.yml (job: patrol): contents, pull-requests + ${app}`,
      `.github/workflows/claude.yml (job: claude): contents, issues, pull-requests + ${app}`,
      `.github/workflows/feedback-distill.yml (job: distill): contents, pull-requests + ${app}`,
      `.github/workflows/quality-regrade.yml (job: regrade): contents, pull-requests + ${app}`,
    ]);
  });

  // The rule the inventory above cannot express (#689). An enumeration catches
  // a *change*; it cannot say which entries are wrong. `health-audit`'s audit
  // job sat in that list for weeks — reviewed as read-only, prompt forbidding
  // every mutation, `issues: write` deliberately isolated in a separate
  // publisher — while its agent's shell held a write-capable app token,
  // because a listed exception reads as accepted.
  //
  // The invariant that would have caught it the day it was written: a job
  // whose `permissions:` block grants no repository write has *declared*
  // itself read-only, and the app-token path silently contradicts that
  // declaration, so such a job must pass `github_token`. Unlike the
  // enumeration this generalises — a new read-only analysis job copied from an
  // existing one fails here without anyone remembering to extend a list.
  //
  // Jobs holding write scopes are deliberately out of its reach: `bug-patrol`,
  // `feedback-distill` and `quality-regrade` push from inside the agent by
  // design, and binding them to `secrets.GITHUB_TOKEN` would also stop the PRs
  // they open from triggering `test.yml` (GitHub does not run workflows on
  // events raised by `GITHUB_TOKEN`). Splitting those on the credential
  // boundary the way sentry-harness was split is a per-loop change, not this
  // contract's business.
  it("forbids a read-only agent job from minting a write-capable app token", () => {
    const generative = workflows.filter((path) => read(path).includes(AGENT_ACTION));

    expect(generative.flatMap((path) => readOnlyMintContradictions(path, read(path)))).toEqual([]);
  });

  it.each([
    {
      shape: "all-read permissions and no github_token",
      permissions: "      contents: read\n      issues: read",
      input: null,
      violates: true,
    },
    {
      // The exact shape health-audit.yml had: `id-token: write` is not a
      // repository write, so the job still reads as read-only — and it is the
      // very scope that makes the OIDC exchange possible.
      shape: "all-read permissions plus id-token: write",
      permissions: "      contents: read\n      id-token: write",
      input: null,
      violates: true,
    },
    {
      shape: "all-read permissions with github_token bound",
      permissions: "      contents: read\n      issues: read",
      input: "          github_token: ${{ secrets.GITHUB_TOKEN }}",
      violates: false,
    },
    {
      // Out of scope by design: the job never claimed to be read-only.
      shape: "a write scope and no github_token",
      permissions: "      contents: write",
      input: null,
      violates: false,
    },
  ])("flags $shape", ({ permissions, input, violates }) => {
    const contents = [
      "name: Synthetic",
      "on: [push]",
      "jobs:",
      "  agent:",
      "    runs-on: ubuntu-latest",
      "    permissions:",
      permissions,
      "    steps:",
      `      - uses: ${AGENT_ACTION}@${"0".repeat(40)}`,
      ...(input === null ? [] : ["        with:", input]),
      "",
    ].join("\n");

    expect(readOnlyMintContradictions("synthetic.yml", contents)).toHaveLength(violates ? 1 : 0);
  });

  // Mutation checks on the real file: the assertion above proves only that
  // today's workflows happen to comply, which is also what a check that
  // inspects nothing reports. Undo either half of the #689 fix and it must go
  // red — and each mutation must actually change the file, so a regex that
  // stops matching after a rewrite fails here instead of passing vacuously.
  it.each([
    {
      half: "the github_token binding is dropped",
      mutate: (contents: string) => contents.replace(/\n {10}github_token: .+\n/, "\n"),
    },
    {
      half: "id-token: write comes back",
      mutate: (contents: string) =>
        contents
          .replace(/\n {10}github_token: .+\n/, "\n")
          .replace(/\n {6}actions: read\n/, "\n      actions: read\n      id-token: write\n"),
    },
  ])("goes red if $half in health-audit", ({ mutate }) => {
    const path = ".github/workflows/health-audit.yml";
    const mutated = mutate(read(path));

    expect(mutated).not.toEqual(read(path));
    expect(readOnlyMintContradictions(path, mutated)).toHaveLength(1);
    // And the job reappears in the push-capable inventory, which is #689's
    // stated acceptance check.
    expect(agentWriteScopeInventory(path, mutated)).toEqual([
      `${path} (job: audit): claude app token (contents, issues, pull-requests)`,
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

  // Issue #736: an unscoped `Bash(gh api:*)` grant is a raw REST client that,
  // with the job's write-capable token, reaches the PR-merge and Contents
  // APIs — defeating "never merge, never touch code" prompts that are
  // otherwise prose-only. See `unscopedGhApiGrants` for the rule.
  it("never grants unscoped gh api in any workflow's --allowedTools", () => {
    expect(workflows.flatMap((path) => unscopedGhApiGrants(path, read(path)))).toEqual([]);
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

  // #699 (the #668 residual): prompt step 5 makes the Sentry agent add a
  // Vitest test, and that file used to execute under test.yml on the
  // unreviewed fix PR — agent-authored code reaching an executor one hop after
  // the credential split. The fix is a quarantine, not a workflow step: the
  // lander only accepts agent tests named `src/**/*.sentry.test.ts(x)`
  // (outbox.ts, covered by outbox.test.ts), and vitest.config.ts excludes that
  // pattern exactly when the CI run's head ref is a `sentry-fix/*` branch.
  // This contract pins the config half so it cannot be dropped without the
  // suite going red.
  describe("sentry-fix PR test quarantine (#699)", () => {
    // A comment restating the guard must not satisfy the contract, so strip
    // TS `//` comments before matching (uncommented() defaults to YAML `#`).
    const config = uncommented(read("vitest.config.ts"), "//");

    it("keys the exclusion off the branch prefix the lander actually pushes", () => {
      // fixBranch() is what names the fix PR's head ref; if it ever changes,
      // the config's prefix check must move with it.
      expect(fixBranch("12345").startsWith("sentry-fix/")).toBe(true);
      expect(config).toContain("GITHUB_HEAD_REF");
      expect(config).toContain('startsWith("sentry-fix/")');
    });

    it("excludes the quarantine glob only on sentry-fix PR runs", () => {
      // The glob must exist, and must be spread conditionally — an
      // unconditional exclude would silence the repro tests everywhere,
      // including after review and merge.
      const conditional = config
        .split("\n")
        .find((line) => line.includes("**/*.sentry.test.{ts,tsx}"));
      expect(conditional, "vitest.config.ts no longer excludes **/*.sentry.test.{ts,tsx}").toBeDefined();
      expect(conditional).toMatch(/\?\s*\[/);
      expect(conditional).toContain(": []");
    });

    it("quarantine-named files are ones the exclusion glob and the lander agree on", () => {
      // The lander's shape (asserted against its exported regex) sits under
      // src/, inside the vitest include roots, where the glob above reaches.
      expect("src/lib/foo.sentry.test.ts").toMatch(SENTRY_TEST_FILE_RE);
      expect("src/components/bar.sentry.test.tsx").toMatch(SENTRY_TEST_FILE_RE);
      // Playwright's tree is not covered by a vitest exclude, so the lander
      // must never quarantine-bless a path there.
      expect("e2e/foo.sentry.test.ts").not.toMatch(SENTRY_TEST_FILE_RE);
    });

    // EXECUTED_TEST_DIRS is a hardcoded allowlist of "CI executes this as a
    // test regardless of filename" directories. Nothing else ties it back to
    // the configs it's describing, so a rename here would silently open a
    // hole. Pin both halves directly against the config values.
    it("stays in sync with the configs it describes", () => {
      expect(EXECUTED_TEST_DIRS).toContain("e2e/");
      expect(read("playwright.config.ts")).toContain('testDir: "./e2e"');

      expect(EXECUTED_TEST_DIRS).toContain("src/__tests__/integration/");
      expect(read("vitest.integration.config.ts")).toContain(
        'include: ["src/__tests__/integration/**/*.test.ts"]',
      );
    });
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
