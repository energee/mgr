#!/usr/bin/env bun
// .github/scripts/land-sentry-fix.ts
//
// Deterministic lander for the Sentry Error Harness (issue #668).
//
// Runs in `sentry-harness.yml`'s `land-fix` job — the only job in that workflow
// holding write scopes, and the only one that runs no generative agent. It
// consumes the artifact produced by the uncredentialed `fix-error` job and
// performs the publishing the agent used to do itself:
//
//   1. validate every field of the untrusted outbox (see sentry-harness/outbox.ts)
//   2. apply the packed patch with `git apply` in a throwaway worktree at the
//      base commit the agent worked from
//   3. commit, push `sentry-fix/SENTRY-<id>`, open the PR from a body *file*
//   4. file or comment on the investigation issue
//   5. write `sentry-outcome.md` for the require-durable-outcome gate
//
// Trust rules, deliberate and load-bearing:
//   - The agent's text NEVER reaches a shell. Every subprocess is spawned with
//     an argv array (no `shell: true`), and bodies/messages travel as files.
//   - The patch is applied with `git apply`, which executes nothing and refuses
//     paths under `.git/`. No script the agent wrote is ever run here.
//   - This file is read from the *trusted* checkout (main's tip) before any
//     agent content is applied, and the patch cannot touch `.github/**` or any
//     other executor (outbox.ts's FORBIDDEN_PATCH_PREFIXES).
//   - A `comment` may only target an issue this harness itself filed: the
//     target's labels are re-read here and must include `sentry-fix`. The
//     agent picks the number, so without that check it picks any issue in the
//     repository.
//
// What this job does NOT remove, stated because the disclosure in
// `sentry-harness.yml` used to omit it: the bodies are agent-authored free text
// and this job publishes them verbatim to a public repository. That is inherent
// to a harness that reports anything at all. The bound is on reach — capped
// length, label-checked comment target, denylisted patch paths — not content.
//
// `landSentryFix()` is exported so `land-sentry-fix.test.ts` can drive the real
// git/gh sequence against a scratch repository with a stub `gh` on PATH; the
// CLI wrapper at the bottom runs only when this file is invoked directly.
//
// Env (CLI mode): OUTBOX_DIR (downloaded artifact, outside the work tree),
// SENTRY_ISSUE_ID, GH_TOKEN, GITHUB_WORKSPACE.

import { existsSync, mkdtempSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  commitSubject,
  fixBranch,
  parseBaseSha,
  parsePlan,
  validatePatch,
  type OutboxPlan,
} from "./sentry-harness/outbox";

/** The label every issue this harness files carries; the comment allow-check. */
export const HARNESS_ISSUE_LABEL = "sentry-fix";

export type LandOptions = {
  /** Directory holding the downloaded artifact (plan.json, bodies, fix.patch). */
  outboxDir: string;
  /** Numeric Sentry issue id, used for the branch name and the summary. */
  issueId: string;
  /** Repository checkout the worktree is created from, and where the outcome file lands. */
  workspace: string;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/** Run a command with an argv array — never a shell string. */
function run(command: string, args: string[], cwd?: string): string {
  const result = spawnSync(command, args, { encoding: "utf8", cwd });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (exit ${result.status}):\n${result.stderr || result.stdout}`,
    );
  }
  return result.stdout.trim();
}

function summary(lines: string[]): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  const text = `${lines.join("\n")}\n`;
  if (file) appendFileSync(file, text);
  else console.log(text);
}

function readOutbox(dir: string, name: string): string {
  const path = join(dir, name);
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8");
}

/**
 * Apply the patch at `baseSha` in a scratch worktree, commit, and push the
 * branch. A separate worktree (rather than checking out `baseSha` in place)
 * keeps this script and its imports on disk untouched by agent content.
 *
 * The branch name is stable per Sentry issue, so a re-run — a second scheduled
 * hit on the same still-unfixed error, or a manual re-dispatch — finds it
 * already published. A plain push fails non-fast-forward there, which used to
 * turn every repeat run of a known error red. It updates the existing branch
 * instead, leasing against the remote tip read a moment earlier so a push that
 * raced someone else's still fails rather than discarding their commits.
 */
function pushFix(
  plan: OutboxPlan,
  baseSha: string,
  patch: string,
  branch: string,
  workspace: string,
): void {
  const scratch = mkdtempSync(join(tmpdir(), "sentry-land-"));
  const tree = join(scratch, "tree");
  const patchFile = join(scratch, "fix.patch");
  const messageFile = join(scratch, "commit-message.txt");
  writeFileSync(patchFile, patch);

  run("git", ["worktree", "add", "--detach", tree, baseSha], workspace);
  try {
    // --check first so a malformed patch fails before anything is staged.
    run("git", ["apply", "--binary", "--whitespace=nowarn", "--check", patchFile], tree);
    run("git", ["apply", "--binary", "--whitespace=nowarn", patchFile], tree);
    run("git", ["add", "-A"], tree);

    const subject = commitSubject(plan.pr?.title ?? "");
    writeFileSync(
      messageFile,
      `${subject}\n\nLanded by sentry-harness.yml's land-fix job from an uncredentialed agent run.\nBase: ${baseSha}\n`,
    );
    run(
      "git",
      [
        "-c",
        "user.name=github-actions[bot]",
        "-c",
        "user.email=41898282+github-actions[bot]@users.noreply.github.com",
        "commit",
        "--file",
        messageFile,
      ],
      tree,
    );

    // `ls-remote` exits 0 with empty output when the branch does not exist.
    const remote = run("git", ["ls-remote", "--heads", "origin", branch], tree);
    const remoteSha = remote.split("\t")[0]?.trim() ?? "";
    const push = ["push"];
    if (/^[0-9a-f]{40}$/.test(remoteSha)) {
      push.push(`--force-with-lease=refs/heads/${branch}:${remoteSha}`);
    }
    push.push("origin", `HEAD:refs/heads/${branch}`);
    run("git", push, tree);
  } finally {
    // Leave no stale worktree registration behind on a re-run in the same
    // checkout; failures here must not mask the real error.
    try {
      run("git", ["worktree", "remove", "--force", tree], workspace);
    } catch {
      /* best effort */
    }
  }
}

/**
 * Open the PR, or report the one that is already open for this branch. `gh pr
 * create` errors when a PR exists for the head ref, and on a re-run the push
 * above has already updated that PR's branch — so the existing URL *is* the
 * outcome, and failing here would go red after publishing.
 */
function createPr(plan: OutboxPlan, branch: string, scratch: string): string {
  const existing = run("gh", [
    "pr",
    "list",
    "--head",
    branch,
    "--state",
    "open",
    "--json",
    "url",
    "--jq",
    ".[0].url // empty",
  ]);
  if (existing) return existing;

  const bodyFile = join(scratch, "pr-body.md");
  writeFileSync(bodyFile, plan.pr?.body ?? "");
  return run("gh", [
    "pr",
    "create",
    "--base",
    "main",
    "--head",
    branch,
    // Same normalization as the commit subject: main squash-merges these PRs,
    // so the PR title becomes a commit subject and AGENTS.md constraint 16
    // applies to it too.
    "--title",
    commitSubject(plan.pr?.title ?? ""),
    "--body-file",
    bodyFile,
    "--label",
    "sentry-fix",
    "--label",
    "automated",
  ]);
}

function createIssue(plan: OutboxPlan, scratch: string): string {
  const bodyFile = join(scratch, "issue-body.md");
  writeFileSync(bodyFile, plan.issue?.body ?? "");
  return run("gh", [
    "issue",
    "create",
    "--title",
    plan.issue?.title ?? "",
    "--body-file",
    bodyFile,
    "--label",
    HARNESS_ISSUE_LABEL,
    "--label",
    "needs-human",
  ]);
}

/**
 * Comment on a prior triage issue. The number comes from the agent, so the
 * target's labels are re-read here: without this the plan can direct a body
 * to any issue in the repository, which is a write the agent chose the
 * destination of.
 */
function addComment(plan: OutboxPlan, scratch: string): string {
  const target = String(plan.comment?.issue);
  const labels = run("gh", [
    "issue",
    "view",
    target,
    "--json",
    "labels",
    "--jq",
    "[.labels[].name] | join(\",\")",
  ])
    .split(",")
    .map((label) => label.trim());
  if (!labels.includes(HARNESS_ISSUE_LABEL)) {
    throw new Error(
      `outbox: comment target #${target} is not labelled \`${HARNESS_ISSUE_LABEL}\`, so it is not an issue this harness filed (labels: ${labels.join(", ") || "none"})`,
    );
  }

  const bodyFile = join(scratch, "comment-body.md");
  writeFileSync(bodyFile, plan.comment?.body ?? "");
  return run("gh", ["issue", "comment", target, "--body-file", bodyFile]);
}

/** Validate the outbox, publish what it declares, and write the outcome file. */
export function landSentryFix({ outboxDir, issueId, workspace }: LandOptions): string[] {
  const branch = fixBranch(issueId);

  const planJson = readOutbox(outboxDir, "plan.json");
  if (!planJson.trim()) {
    throw new Error(
      `${outboxDir}/plan.json is missing or empty — the agent job produced no plan. Check its step log for permission_denials or an aborted run.`,
    );
  }
  const plan = parsePlan(planJson, (file) => readOutbox(outboxDir, file));
  const baseSha = parseBaseSha(readOutbox(outboxDir, "base-sha"));
  const patch = readOutbox(outboxDir, "fix.patch");
  const paths = validatePatch(plan, patch);

  const scratch = mkdtempSync(join(tmpdir(), "sentry-outbox-"));
  const outcomes: string[] = [];
  const notes = [
    `### Sentry harness landing (SENTRY-${issueId})`,
    "",
    `Classification: ${plan.classification}`,
  ];

  if (plan.pr) {
    pushFix(plan, baseSha, patch, branch, workspace);
    const url = createPr(plan, branch, scratch);
    outcomes.push(url);
    notes.push(`Patch: ${paths.length} path(s) applied at ${baseSha}`, `PR: ${url}`);
  }
  if (plan.issue) {
    const url = createIssue(plan, scratch);
    outcomes.push(url);
    notes.push(`Issue: ${url}`);
  }
  if (plan.comment) {
    const url = addComment(plan, scratch);
    outcomes.push(url);
    notes.push(`Comment on #${plan.comment.issue}: ${url}`);
  }

  // The gate reads this from the workspace root: an `Outcome:` URL satisfies
  // the citation rung, an `Evidence:` block satisfies the quiet-run rung.
  const outcomeFile = join(workspace, "sentry-outcome.md");
  if (outcomes.length > 0) {
    writeFileSync(outcomeFile, `${outcomes.map((url) => `Outcome: ${url}`).join("\n")}\n`);
  } else {
    const quiet = plan.quietRun;
    if (!quiet) throw new Error("outbox: no PR, issue or comment, and no quietRun evidence");
    writeFileSync(outcomeFile, `No artifact: ${quiet.reason}\n\nEvidence:\n${quiet.evidence}\n`);
    notes.push(`Quiet run: ${quiet.reason}`);
  }

  return notes;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  try {
    summary(
      landSentryFix({
        outboxDir: requireEnv("OUTBOX_DIR"),
        issueId: requireEnv("SENTRY_ISSUE_ID"),
        workspace: process.env.GITHUB_WORKSPACE ?? process.cwd(),
      }),
    );
  } catch (error) {
    console.error("[land-sentry-fix]", error instanceof Error ? error.message : error);
    summary([
      "### Sentry harness landing FAILED",
      "",
      "```",
      error instanceof Error ? error.message : String(error),
      "```",
    ]);
    process.exit(1);
  }
}
