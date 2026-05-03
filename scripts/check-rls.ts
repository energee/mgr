#!/usr/bin/env bun
/**
 * scripts/check-rls.ts
 *
 * Fails (exit 1) if any `CREATE TABLE` in `supabase/migrations/` is not
 * paired with `ENABLE ROW LEVEL SECURITY` in the same migration file.
 *
 * Rationale: docs/agents/db-security.md. A table without RLS enabled is
 * world-readable through PostgREST.
 *
 * Whitelist: tables that are intentionally public (e.g. lookup / catalog
 * tables seeded only by migrations) must add a comment of the form
 * `-- check-rls: skip <reason>` on the line above the CREATE TABLE.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";

type Hit = { file: string; line: number; tableName: string };

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (full.endsWith(".sql")) yield full;
  }
}

const hits: Hit[] = [];

for (const file of walk(MIGRATIONS_DIR)) {
  const content = readFileSync(file, "utf8");
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(
      /^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/i,
    );
    if (!match) continue;

    const tableName = match[1].replace(/^public\./, "").replace(/"/g, "");
    if (tableName.startsWith("_")) continue; // internal: _schema_registry etc. — caller's call

    const prevLine = lines[i - 1] ?? "";
    if (/check-rls:\s*skip/i.test(prevLine)) continue;

    // Look across the whole migration for an ENABLE ROW LEVEL SECURITY on this table.
    const enablePattern = new RegExp(
      `ALTER\\s+TABLE\\s+(?:public\\.)?${tableName.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
      "i",
    );

    if (!enablePattern.test(content)) {
      hits.push({ file, line: i + 1, tableName });
    }
  }
}

if (hits.length === 0) {
  console.log("OK: every CREATE TABLE in supabase/migrations/ has matching ENABLE ROW LEVEL SECURITY");
  process.exit(0);
}

console.error("FAIL: tables missing `ENABLE ROW LEVEL SECURITY`:\n");
for (const hit of hits) {
  console.error(`  ${hit.file}:${hit.line}  ${hit.tableName}`);
}
console.error("\nFix: add `ALTER TABLE <name> ENABLE ROW LEVEL SECURITY;` plus at least one policy.");
console.error("     See docs/agents/db-security.md.");
console.error("     Or whitelist with `-- check-rls: skip <reason>` above the line.");
process.exit(1);
