#!/usr/bin/env bun
/**
 * scripts/check-search-path.ts
 *
 * Fails (exit 1) if any CREATE FUNCTION in supabase/migrations/ does not
 * include `SET search_path = public` (or another explicit schema).
 *
 * Rationale: docs/agents/db-security.md (DEC-SEC-003). Without an
 * explicit search_path, callers can shadow public-schema objects in
 * their own schema and hijack the function.
 *
 * Migration-history-aware: latest CREATE OR REPLACE FUNCTION wins.
 *
 * Whitelist: `-- check-search-path: skip <reason>` above the line.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";

type Definition = {
  name: string;
  file: string;
  startLine: number;
  body: string[];
};

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (full.endsWith(".sql")) yield full;
  }
}

const latest = new Map<string, Definition>();
const skipped = new Set<string>();

for (const file of walk(MIGRATIONS_DIR)) {
  const lines = readFileSync(file, "utf8").split("\n");
  let state: "idle" | "in_function" = "idle";
  let current: Definition | null = null;
  let dollarBalance = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (state === "idle") {
      const m = line.match(/^\s*CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w."]+)/i);
      if (!m) continue;
      state = "in_function";
      dollarBalance = 0;
      current = { name: m[1], file, startLine: i + 1, body: [] };
      if (/check-search-path:\s*skip/i.test(lines[i - 1] ?? "")) {
        skipped.add(m[1]);
      }
      // fall through to push line and check end-of-function on the SAME line
      // (single-line `CREATE FUNCTION ... AS $$ ... $$ LANGUAGE sql;`).
    }

    if (!current) continue;
    current.body.push(line);

    const dollars = (line.match(/\$\$/g) ?? []).length;
    dollarBalance += dollars;

    if (
      (dollarBalance >= 2 && /\$\$\s*(LANGUAGE|;)/i.test(line)) ||
      (/;\s*$/.test(line.replace(/--.*$/, "")) && dollarBalance === 0 && current.body.length > 1)
    ) {
      latest.set(current.name, current);
      state = "idle";
      current = null;
    }
  }
}

const violations: Definition[] = [];

for (const def of latest.values()) {
  if (skipped.has(def.name)) continue;

  // Per DEC-SEC-003 only the proc-level attribute is enforced by Postgres.
  // Postgres accepts `SET search_path = ...` either in the header (before
  // `AS $$`) OR in the trailing attributes (after the closing `$$`). The
  // ONLY place that doesn't count is inside the body itself — a body-level
  // `EXECUTE 'SET search_path = ...'` does not configure the proc. Mask the
  // body between the first and last `$$` and check the remaining string.
  const fullText = def.body.join("\n");
  const noLineComments = fullText.replace(/--.*$/gm, "");
  const firstDollar = noLineComments.indexOf("$$");
  const lastDollar = noLineComments.lastIndexOf("$$");

  const attrText =
    firstDollar !== -1 && lastDollar > firstDollar
      ? noLineComments.slice(0, firstDollar) +
        " " +
        noLineComments.slice(lastDollar + 2)
      : noLineComments; // SQL-language single-line functions with no $$

  if (!/SET\s+search_path\s*(?:=|TO)/i.test(attrText)) {
    violations.push(def);
  }
}

if (violations.length === 0) {
  console.log("OK: every CREATE FUNCTION sets an explicit search_path");
  process.exit(0);
}

console.error("FAIL: functions without explicit `SET search_path`:\n");
for (const v of violations) {
  console.error(`  ${v.file}:${v.startLine}  ${v.name}`);
}
console.error("\nFix: add `SET search_path = public` between LANGUAGE and AS.");
console.error("     See docs/agents/db-security.md (DEC-SEC-003).");
console.error("     Or whitelist with `-- check-search-path: skip <reason>`.");
process.exit(1);
