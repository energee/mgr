#!/usr/bin/env bun
/**
 * scripts/check-rls.ts
 *
 * Fails (exit 1) if any `CREATE TABLE` in `supabase/migrations/` is not
 * paired with `ENABLE ROW LEVEL SECURITY` somewhere across the migration
 * history. Migration-history-aware: a `CREATE TABLE` in 00100 satisfied
 * by an `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` in 00150 passes.
 *
 * Files are processed in lexical order, which matches Supabase's apply
 * order (`00XXX_…`).
 *
 * Rationale: docs/agents/db-security.md. A table without RLS enabled is
 * world-readable through PostgREST.
 *
 * Whitelist: tables that are intentionally public must add a comment of
 * the form `-- check-rls: skip <reason>` on the line above CREATE TABLE.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";

type Hit = { file: string; line: number; tableName: string };

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (full.endsWith(".sql")) yield full;
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const hits: Hit[] = [];
const allContent: string[] = [];

// First pass: build the full-history content blob.
const files: string[] = [];
for (const file of walk(MIGRATIONS_DIR)) {
  files.push(file);
  allContent.push(readFileSync(file, "utf8"));
}
const fullText = allContent.join("\n");

// Second pass: per-table CREATE detection + history-wide ENABLE search.
for (let f = 0; f < files.length; f++) {
  const file = files[f];
  const lines = allContent[f].split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(
      /^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/i,
    );
    if (!match) continue;

    const tableName = match[1].replace(/^public\./, "").replace(/"/g, "");
    if (tableName.startsWith("_")) continue;

    const prevLine = lines[i - 1] ?? "";
    if (/check-rls:\s*skip/i.test(prevLine)) continue;

    const enablePattern = new RegExp(
      `ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?(?:public\\.)?${escapeRe(tableName)}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
      "i",
    );

    if (!enablePattern.test(fullText)) {
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
console.error("     Either in the same migration as CREATE TABLE, or in a later corrective migration.");
console.error("     See docs/agents/db-security.md.");
console.error("     Or whitelist with `-- check-rls: skip <reason>` above the line.");
process.exit(1);
