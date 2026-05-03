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

const inProgressOnThisBranch = list.features.filter(
  (f) => f.state === "in_progress" && (f.branch ?? "main") === branch,
);

const inProgressUnscoped = list.features.filter(
  (f) => f.state === "in_progress" && f.branch === undefined,
);

if (inProgressOnThisBranch.length <= 1 && inProgressUnscoped.length <= 1) {
  const total = inProgressOnThisBranch.length + (branch === "main" ? 0 : inProgressUnscoped.length);
  console.log(`OK: ${total} in-progress feature(s) on branch \`${branch}\` (WIP=1 satisfied)`);
  process.exit(0);
}

console.error(`FAIL: WIP=1 violated on branch \`${branch}\`:\n`);
for (const f of inProgressOnThisBranch) {
  console.error(`  ${f.id}  [branch: ${f.branch ?? "main"}]  ${f.title}`);
}
for (const f of inProgressUnscoped) {
  if (!inProgressOnThisBranch.includes(f)) {
    console.error(`  ${f.id}  [unscoped]      ${f.title}`);
  }
}
console.error("\nFix: pause one of the in-progress features (set state to `blocked` or");
console.error("     `not_started`) before starting another, or add a `branch` field to");
console.error("     each feature so they tracked per-branch instead of globally.");
console.error("     See AGENTS.md \"Work-in-progress rule\".");
process.exit(1);
