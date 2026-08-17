#!/usr/bin/env bun
/**
 * scripts/check-write-atomicity.ts
 *
 * Fails (exit 1) when a source file contains two or more awaited PostgREST
 * mutations (`await …supabase….from(…).insert/update/delete/upsert`) and
 * carries neither a `// tx-ok: <reason>` justification comment nor an
 * allowlist entry.
 *
 * Rationale: PostgREST calls are per-request autocommit — two awaited
 * `.from()` writes are two transactions, always. Write chains that must
 * succeed together belong in a single SQL RPC. This pattern produced 16 of
 * the 50 issues analyzed on 2026-07-16 (#446/#447/#443/#444/#445/#434 …);
 * see docs/plans/2026-07-16-issue-insights.md and the
 * transaction-safety-reviewer agent.
 *
 * Suppression: `// tx-ok: <reason>` anywhere in the file states why the
 * writes are independent (no shared invariant) or how they compensate.
 * ponytail: file-granular scan — it cannot see function boundaries, so one
 * tx-ok covers the whole file and edits inside grandfathered files pass
 * silently; upgrade to an AST-based per-function rule if that ceiling bites.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC_DIR = "src";
const ALLOWLIST_PATH = "scripts/check-write-atomicity.allowlist.txt";
const MUTATION = /\.(insert|update|delete|upsert)\s*\(/;
// Matches both `supabase.from(` and the repo's own `dynamicFrom(supabase, "t")`
// helper. Without the second alternative this gate was blind to every file
// written through dynamicFrom — the preferred pattern wherever the generated
// types lag the migration chain — and reported them clean rather than
// unexamined. A silent pass is worse than a noisy one for an atomicity gate.
const FROM = /(\.|\bdynamic)[Ff]rom\s*\(/;
// How far past an `await` the chain is allowed to stretch (multiline chains).
const CHAIN_WINDOW = 300;

const allowlist = new Set<string>(
  existsSync(ALLOWLIST_PATH)
    ? readFileSync(ALLOWLIST_PATH, "utf8")
        .split("\n")
        .map((l) => l.replace(/#.*$/, "").trim())
        .filter(Boolean)
    : [],
);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue;
      yield* walk(full);
    } else if (/\.(ts|tsx)$/.test(full) && !/\.test\.tsx?$/.test(full)) {
      yield full;
    }
  }
}

function countAwaitedWrites(source: string): number {
  let count = 0;
  const segments = source.split(/\bawait\b/).slice(1);
  for (const segment of segments) {
    const chain = segment.slice(0, CHAIN_WINDOW);
    if (FROM.test(chain) && MUTATION.test(chain)) count++;
  }
  return count;
}

const violations: Array<{ file: string; writes: number }> = [];

for (const file of walk(SRC_DIR)) {
  const source = readFileSync(file, "utf8");
  const writes = countAwaitedWrites(source);
  if (writes < 2) continue;
  if (allowlist.has(file)) continue;
  if (/\/\/\s*tx-ok:/.test(source)) continue;
  violations.push({ file, writes });
}

if (violations.length === 0) {
  console.log("OK: no unjustified multi-write files (PostgREST autocommit gate)");
  process.exit(0);
}

console.error("FAIL: files with 2+ awaited PostgREST mutations and no atomicity justification:\n");
for (const v of violations) {
  console.error(`  ${v.file}  (${v.writes} awaited writes)`);
}
console.error("\nPostgREST calls are per-request autocommit — multiple awaited writes are");
console.error("multiple transactions. If these writes must succeed together, move them");
console.error("into one SQL RPC (see transition_entity_atomic, 00256, or 00257).");
console.error("If they are genuinely independent, add `// tx-ok: <reason>` to the file.");
console.error("");
console.error(`Allowlist: pre-gate files are grandfathered in ${ALLOWLIST_PATH}.`);
console.error("           Do NOT add new entries there — use an RPC or inline tx-ok instead.");
process.exit(1);
