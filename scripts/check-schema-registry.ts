#!/usr/bin/env bun
/**
 * scripts/check-schema-registry.ts
 *
 * Fails (exit 1) if any CREATE TABLE in supabase/migrations/ lacks a
 * matching `INSERT INTO _schema_registry (table_name, ...) VALUES
 * (..., '<table>', ...)` somewhere in the migration history.
 *
 * Rationale: MGR's "Schema as Documentation" principle. The
 * _schema_registry is queried by AI tooling to understand table purpose,
 * domain, and relationships. New tables without entries are invisible
 * to that surface.
 *
 * Whitelist: `-- check-schema-registry: skip <reason>` above CREATE.
 * Internal tables (those starting with `_`) are skipped automatically.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";
const ALLOWLIST_PATH = "scripts/check-schema-registry.allowlist.txt";

const allowlistedFiles = new Set<string>(
  existsSync(ALLOWLIST_PATH)
    ? readFileSync(ALLOWLIST_PATH, "utf8")
        .split("\n")
        .map((l) => l.replace(/#.*$/, "").trim())
        .filter(Boolean)
    : [],
);

type CreatedTable = { name: string; file: string; line: number };

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (full.endsWith(".sql")) yield full;
  }
}

const created: CreatedTable[] = [];
const allContent: string[] = [];

for (const file of walk(MIGRATIONS_DIR)) {
  const content = readFileSync(file, "utf8");
  allContent.push(content);
  if (allowlistedFiles.has(basename(file))) continue;
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(
      /^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/i,
    );
    if (!m) continue;

    const tableName = m[1].replace(/^public\./, "").replace(/"/g, "");
    if (tableName.startsWith("_")) continue;

    const prevLine = lines[i - 1] ?? "";
    if (/check-schema-registry:\s*skip/i.test(prevLine)) continue;

    created.push({ name: tableName, file, line: i + 1 });
  }
}

const fullText = allContent.join("\n");
const violations: CreatedTable[] = [];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

for (const t of created) {
  // Look for the table name as a quoted string in any INSERT INTO _schema_registry block.
  const re = new RegExp(
    `INSERT\\s+INTO\\s+_schema_registry[\\s\\S]*?VALUES[\\s\\S]*?\\(\\s*'${escapeRe(t.name)}'`,
    "i",
  );
  if (!re.test(fullText)) violations.push(t);
}

if (violations.length === 0) {
  console.log("OK: every public table has a matching _schema_registry entry");
  process.exit(0);
}

console.error("FAIL: tables without _schema_registry entries:\n");
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  ${v.name}`);
}
console.error("\nFix: add `INSERT INTO _schema_registry (table_name, description, domain,");
console.error("     relationships, key_fields, ...) VALUES ('<table>', ...);`");
console.error("     in the same migration. See an existing migration for shape.");
console.error("     Or whitelist with `-- check-schema-registry: skip <reason>`.");
process.exit(1);
