#!/usr/bin/env bun
/**
 * scripts/feature-mark.ts
 *
 * Safely mutate a feature's state in docs/feature_list.json.
 *
 * Usage:
 *   bun scripts/feature-mark.ts <FEATURE_ID> <STATE> [--branch=<branch>] [--evidence=<text>]
 *
 * Examples:
 *   bun scripts/feature-mark.ts F003 in_progress
 *   bun scripts/feature-mark.ts F003 passing --evidence="commit:abc123"
 *   bun scripts/feature-mark.ts F200 blocked --evidence="waiting on design review"
 *
 * Validates: state is one of {not_started, in_progress, blocked, passing}.
 * Checks WIP=1 per branch when transitioning to in_progress.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const VALID_STATES = ["not_started", "in_progress", "blocked", "passing"];
const PATH = "docs/feature_list.json";

function usage(): never {
  console.error(
    "Usage: bun scripts/feature-mark.ts <FEATURE_ID> <STATE> [--branch=<branch>] [--evidence=<text>]",
  );
  console.error(`States: ${VALID_STATES.join(", ")}`);
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.length < 2) usage();

const id = args[0];
const newState = args[1];
if (!VALID_STATES.includes(newState)) {
  console.error(`ERROR: invalid state '${newState}'. Valid: ${VALID_STATES.join(", ")}`);
  process.exit(2);
}

let branchOverride: string | null = null;
let evidence: string | null = null;
for (const a of args.slice(2)) {
  if (a.startsWith("--branch=")) branchOverride = a.slice("--branch=".length);
  else if (a.startsWith("--evidence=")) evidence = a.slice("--evidence=".length);
  else {
    console.error(`ERROR: unknown argument '${a}'`);
    usage();
  }
}

const branch =
  branchOverride ??
  execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();

type Feature = {
  id: string;
  title: string;
  state: string;
  branch?: string;
  evidence?: string | null;
};

const json = JSON.parse(readFileSync(PATH, "utf8")) as {
  features: Feature[];
  [k: string]: unknown;
};

const feature = json.features.find((f) => f.id === id);
if (!feature) {
  console.error(`ERROR: feature '${id}' not found`);
  process.exit(2);
}

const previous = { state: feature.state, branch: feature.branch, evidence: feature.evidence };

if (newState === "in_progress" && feature.state !== "in_progress") {
  const competing = json.features.filter(
    (f) =>
      f.id !== id &&
      f.state === "in_progress" &&
      (f.branch ?? "main") === branch,
  );
  if (competing.length > 0) {
    console.error(`ERROR: WIP=1 violated on branch '${branch}'.`);
    console.error("       Already in_progress:");
    for (const c of competing) console.error(`       - ${c.id}  ${c.title}`);
    console.error("       Pause those first (set state to blocked or not_started).");
    process.exit(1);
  }
}

feature.state = newState;
if (branchOverride !== null) feature.branch = branchOverride;
if (evidence !== null) feature.evidence = evidence;

writeFileSync(PATH, JSON.stringify(json, null, 2) + "\n");

console.log(`OK: ${id}  ${previous.state} -> ${newState}` + (branchOverride ? ` (branch=${branch})` : ""));
if (evidence) console.log(`    evidence: ${evidence}`);
