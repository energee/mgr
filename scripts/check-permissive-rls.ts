#!/usr/bin/env bun
/**
 * scripts/check-permissive-rls.ts
 *
 * Fails (exit 1) if any RLS policy in supabase/migrations/ uses a fully
 * permissive `USING (true)` or `WITH CHECK (true)` without justification.
 *
 * Rationale: docs/agents/db-security.md. `WITH CHECK (true)` defeats the
 * purpose of the policy — it permits every row regardless of caller.
 *
 * Per-policy block tracking: the scanner walks each CREATE POLICY block
 * (delimited by the closing `;`) and inspects every `USING (true)` /
 * `WITH CHECK (true)` line inside that block.
 *
 * NOTE: this scanner is NOT migration-history-aware. It does not track
 * `DROP POLICY` statements, so a `USING (true)` in an early migration
 * that is later dropped + recreated (e.g. the 00092 mass-policy rewrite)
 * will still be flagged. Pre-rewrite migrations are grandfathered via
 * the file-level allowlist
 * (`scripts/check-permissive-rls.allowlist.txt`).
 *
 * A `-- check-permissive-rls: skip <reason>` comment placed:
 *   - directly above CREATE POLICY, OR
 *   - directly above any individual USING / WITH CHECK line
 * exempts that whole policy or that line.
 *
 * Reasonable skips: read-only public catalogs, single-tenant shared
 * config, audit-log inserts that intentionally accept everything.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";
const ALLOWLIST_PATH = "scripts/check-permissive-rls.allowlist.txt";

const allowlistedFiles = new Set<string>(
  existsSync(ALLOWLIST_PATH)
    ? readFileSync(ALLOWLIST_PATH, "utf8")
        .split("\n")
        .map((l) => l.replace(/#.*$/, "").trim())
        .filter(Boolean)
    : [],
);

type Hit = { file: string; line: number; snippet: string; policyName: string };

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (full.endsWith(".sql")) yield full;
  }
}

const hits: Hit[] = [];

for (const file of walk(MIGRATIONS_DIR)) {
  if (allowlistedFiles.has(basename(file))) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  let inPolicy = false;
  let policyName = "";
  let policySkipped = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const codePart = line.replace(/--.*$/, "");

    const policyStart = codePart.match(/^\s*CREATE\s+POLICY\s+([\w."]+|"[^"]+")/i);
    if (policyStart) {
      inPolicy = true;
      policyName = policyStart[1].replace(/"/g, "");
      policySkipped = /check-permissive-rls:\s*skip/i.test(lines[i - 1] ?? "");
      // fall through — a single-line `CREATE POLICY foo ON t FOR SELECT
      // USING (true);` must have the same line inspected.
    }
    if (!inPolicy) continue;

    if (/\b(USING|WITH\s+CHECK)\s*\(\s*true\s*\)/i.test(codePart)) {
      const lineSkipped = /check-permissive-rls:\s*skip/i.test(lines[i - 1] ?? "");
      if (!policySkipped && !lineSkipped) {
        hits.push({ file, line: i + 1, snippet: line.trim(), policyName });
      }
    }

    // Use codePart (line with trailing `-- comment` stripped) so semicolons
    // inside SQL string literals or comments don't prematurely end the block.
    if (/;\s*$/.test(codePart)) {
      inPolicy = false;
      policySkipped = false;
      policyName = "";
    }
  }
}

if (hits.length === 0) {
  console.log("OK: no unjustified permissive policies");
  process.exit(0);
}

console.error("FAIL: permissive RLS policies detected:\n");
for (const hit of hits) {
  console.error(`  ${hit.file}:${hit.line}  [${hit.policyName}]  ${hit.snippet}`);
}
console.error("\nFix: tighten the policy to `auth.uid() = user_id` or similar.");
console.error("     Or whitelist with `-- check-permissive-rls: skip <reason>`");
console.error("     above CREATE POLICY (covers the whole policy) or above the");
console.error("     individual USING / WITH CHECK line.");
console.error("");
console.error(`Allowlist: pre-harness migrations are grandfathered in ${ALLOWLIST_PATH}.`);
console.error("           Do NOT add new entries there — use inline justification instead.");
console.error("See docs/agents/db-security.md.");
process.exit(1);
