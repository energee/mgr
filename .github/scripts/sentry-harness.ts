#!/usr/bin/env bun
// .github/scripts/sentry-harness.ts
//
// Entry point for the Sentry Error Harness. Run inside GitHub Actions.
// Reads env, fetches unresolved Sentry issues, scores them, excludes those
// that already have an open PR or a merged fix with no events since the
// merge, and emits up to 5 as GITHUB_OUTPUT for a matrix job to consume.

import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { filterClaimedIssues, filterFixedIssues, type MergedFixPr } from "./sentry-harness/dedup";
import { buildFixPrompt } from "./sentry-harness/prompt";
import { scoreIssues, sortByScore } from "./sentry-harness/scoring";
import { fetchIssuesWithStacks } from "./sentry-harness/sentry-api";
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
function ghPrList<T>(args: string[]): T {
  const result = spawnSync("gh", ["pr", "list", ...args], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`gh pr list failed: ${result.stderr}`);
  }
  return JSON.parse(result.stdout) as T;
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
  const issues = await fetchIssuesWithStacks({ org, project, authToken, environment });
  console.error(`[harness] Fetched ${issues.length} issues`);

  const openBranches = listOpenSentryFixBranches();
  console.error(`[harness] ${openBranches.length} open sentry-fix PRs`);
  const unclaimed = filterClaimedIssues(issues, openBranches);
  const mergedPrs = listMergedSentryFixPrs();
  console.error(`[harness] ${mergedPrs.length} merged sentry-fix PRs`);
  const eligible = filterFixedIssues(unclaimed, mergedPrs);
  console.error(`[harness] ${eligible.length} eligible after dedup`);

  const scored = scoreIssues(eligible);
  const sorted = sortByScore(scored);
  const top = sorted.slice(0, MAX_ERRORS_PER_RUN);

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
