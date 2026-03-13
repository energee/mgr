#!/usr/bin/env node --experimental-strip-types
/**
 * Lint Suppression Budget
 *
 * Counts eslint-disable and @ts- suppression comments in src/.
 * Fails if the count exceeds the budget, preventing regression.
 * Run via: bun lint:suppressions
 */

import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BUDGET = 15;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let output: string;
try {
  output = execFileSync(
    "grep",
    [
      "-r",
      "-E",
      "eslint-disable|@ts-ignore|@ts-expect-error|@ts-nocheck",
      "src/",
      "--include=*.ts",
      "--include=*.tsx",
      "-c",
    ],
    { cwd: root, encoding: "utf-8" }
  );
} catch (e: unknown) {
  // grep exits 1 when no matches — treat as 0
  output = (e as { stdout?: string }).stdout ?? "";
}

const count = output
  .trim()
  .split("\n")
  .filter(Boolean)
  .reduce((sum: number, line: string) => {
    const match = line.match(/:(\d+)$/);
    return sum + (match ? parseInt(match[1], 10) : 0);
  }, 0);

if (count > BUDGET) {
  console.error(
    `\n❌ Lint suppression budget exceeded: ${count} found, budget is ${BUDGET}.\n` +
      `   Fix suppressions or update the budget in scripts/check-lint-suppressions.mts\n`
  );
  process.exit(1);
} else {
  console.log(
    `✅ Lint suppressions: ${count}/${BUDGET} (${BUDGET - count} remaining)`
  );
}
