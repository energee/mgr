#!/usr/bin/env bun
// .github/scripts/sentry-harness.ts
//
// Entry point for the Sentry Error Harness. Run inside GitHub Actions.
// Reads env, fetches unresolved Sentry issues, scores them, excludes those
// that already have an open PR or a merged fix with no events since the
// merge, and emits up to 5 as GITHUB_OUTPUT for a matrix job to consume.

import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  filterClaimedIssues,
  filterFixedIssues,
  filterTriagedIssues,
  isWorktreeArtifact,
  type MergedFixPr,
  type TriageIssue,
} from "./sentry-harness/dedup";
import { buildFixPrompt } from "./sentry-harness/prompt";
import { scoreIssues, sortByScore } from "./sentry-harness/scoring";
import { enrichIssuesWithEvents, fetchIssueSummaries } from "./sentry-harness/sentry-api";
import type { ScoredIssue } from "./sentry-harness/types";

const MAX_ERRORS_PER_RUN = 5;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

// No --search here: GitHub's search API returns empty results under the
// Actions GITHUB_TOKEN (observed in run 28745947348 — 0 hits vs. 11 real
// sentry-fix PRs), silently disabling dedup. Fetch the plain PR list and
// let the branch regex in dedup.ts pick out sentry-fix branches.
function ghList<T>(subcommand: "pr" | "issue", args: string[]): T {
  const result = spawnSync("gh", [subcommand, "list", ...args], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`gh ${subcommand} list failed: ${result.stderr}`);
  }
  return JSON.parse(result.stdout) as T;
}

function ghPrList<T>(args: string[]): T {
  return ghList<T>("pr", args);
}

// Plain list + title regex in dedup.ts, for the same --search reason above.
function listSentryTriageIssues(): TriageIssue[] {
  return ghList<TriageIssue[]>("issue", [
    "--state", "all", "--json", "title,state,closedAt", "--limit", "200",
  ]);
}

function listOpenSentryFixBranches(): string[] {
  return ghPrList<Array<{ headRefName: string }>>([
    "--state", "open", "--json", "headRefName", "--limit", "100",
  ]).map((p) => p.headRefName);
}

function listMergedSentryFixPrs(): MergedFixPr[] {
  return ghPrList<MergedFixPr[]>([
    "--state", "merged", "--json", "headRefName,mergedAt", "--limit", "100",
  ]);
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
  const summaries = await fetchIssueSummaries({ org, project, authToken, environment });
  console.error(`[harness] Fetched ${summaries.length} issue summaries`);

  // Summary-level artifact filter catches markers in title/culprit (compile
  // errors embed the worktree path there); the post-enrichment pass below
  // catches the rest via stack-trace chunk paths.
  const issues = summaries.filter((i) => !isWorktreeArtifact(i));
  if (issues.length < summaries.length) {
    console.error(`[harness] Dropped ${summaries.length - issues.length} worktree dev artifacts (summary pass)`);
  }

  const openBranches = listOpenSentryFixBranches();
  console.error(`[harness] ${openBranches.length} open sentry-fix PRs`);
  const unclaimed = filterClaimedIssues(issues, openBranches);
  const mergedPrs = listMergedSentryFixPrs();
  console.error(`[harness] ${mergedPrs.length} merged sentry-fix PRs`);
  const unfixed = filterFixedIssues(unclaimed, mergedPrs);
  const triageIssues = listSentryTriageIssues();
  console.error(`[harness] ${triageIssues.length} GitHub issues scanned for prior triage`);
  const eligible = filterTriagedIssues(unfixed, triageIssues);
  console.error(`[harness] ${eligible.length} eligible after dedup`);

  const scored = scoreIssues(eligible);
  const sorted = sortByScore(scored);
  const selected = sorted.slice(0, MAX_ERRORS_PER_RUN);
  console.error(`[harness] Fetching event diagnostics for ${selected.length} selected issues`);
  const enriched = await enrichIssuesWithEvents(selected, authToken);

  // ponytail: dropped artifacts are not backfilled from the sorted remainder —
  // add backfill only if runs start emitting short matrices for real errors.
  const top = enriched.filter((issue) => {
    if (!isWorktreeArtifact(issue)) return true;
    console.error(`[harness] Dropped ${issue.shortId}: worktree dev artifact (stack-trace pass)`);
    return false;
  });

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
