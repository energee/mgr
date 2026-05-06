#!/usr/bin/env bun
/**
 * scripts/check-wip.ts
 *
 * Fails (exit 1) if `docs/feature_list.json` has more than one feature
 * with `state: "in_progress"` for the current branch.
 *
 * Rationale: AGENTS.md hard rule — WIP=1 per branch. Without enforcement
 * the rule is aspirational.
 *
 * Branch detection: features may opt-in to per-branch tracking by adding
 * a `branch` field. Features without a `branch` field count toward the
 * default branch's WIP. Override the branch with the BRANCH env var.
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const branch =
  process.env.BRANCH ??
  execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();

type Feature = {
  id: string;
  title: string;
  state: string;
  branch?: string;
};

const list = JSON.parse(readFileSync("docs/feature_list.json", "utf8")) as {
  features: Feature[];
};

// Single union semantic: a feature counts toward the current branch's WIP
// iff its effective branch (`f.branch ?? "main"`) equals the current branch.
// Unscoped features fold into `main` — they count there, not on feature
// branches. Same semantic as scripts/feature-mark.ts.
const effectiveOnBranch = list.features.filter(
  (f) => f.state === "in_progress" && (f.branch ?? "main") === branch,
);

if (effectiveOnBranch.length <= 1) {
  console.log(
    `OK: ${effectiveOnBranch.length} in-progress feature(s) on branch \`${branch}\` (WIP=1 satisfied)`,
  );
  process.exit(0);
}

console.error(`FAIL: WIP=1 violated on branch \`${branch}\`:\n`);
for (const f of effectiveOnBranch) {
  console.error(`  ${f.id}  [branch: ${f.branch ?? "main"}]  ${f.title}`);
}
console.error("\nFix: pause one of the in-progress features (set state to `blocked` or");
console.error("     `not_started`) before starting another. Run via `make feature-mark`.");
console.error("     See AGENTS.md \"Work-in-progress rule\".");
process.exit(1);
