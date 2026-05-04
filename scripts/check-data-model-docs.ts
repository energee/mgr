#!/usr/bin/env bun
/**
 * scripts/check-data-model-docs.ts
 *
 * Fails (exit 1) if any non-internal table created in supabase/migrations/
 * is not mentioned anywhere in docs/data-model/.
 *
 * Rationale: docs/data-model/ is the human-facing schema reference. New
 * tables added without a doc mention create silent gaps.
 *
 * Whitelist: `-- check-data-model-docs: skip <reason>` above CREATE.
 * Internal tables (those starting with `_`) are skipped automatically.
 *
 * Note: this is a "mention" check, not a structure check. A table is
 * considered documented if its name appears anywhere under docs/data-model/.
 * This intentionally tolerates passing references — the cost of stricter
 * matching is too high for the benefit.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";
const DOCS_DIR = "docs/data-model";
const ALLOWLIST_PATH = "scripts/check-data-model-docs.allowlist.txt";

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
    else yield full;
  }
}

const created: CreatedTable[] = [];

for (const file of walk(MIGRATIONS_DIR)) {
  if (!file.endsWith(".sql")) continue;
  if (allowlistedFiles.has(basename(file))) continue;
  const lines = readFileSync(file, "utf8").split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(
      /^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/i,
    );
    if (!m) continue;

    const tableName = m[1].replace(/^public\./, "").replace(/"/g, "");
    if (tableName.startsWith("_")) continue;

    const prevLine = lines[i - 1] ?? "";
    if (/check-data-model-docs:\s*skip/i.test(prevLine)) continue;

    created.push({ name: tableName, file, line: i + 1 });
  }
}

let docsBlob = "";
for (const file of walk(DOCS_DIR)) {
  if (!file.endsWith(".md")) continue;
  docsBlob += readFileSync(file, "utf8") + "\n";
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const violations: CreatedTable[] = [];
for (const t of created) {
  const re = new RegExp(`\\b${escapeRe(t.name)}\\b`);
  if (!re.test(docsBlob)) violations.push(t);
}

if (violations.length === 0) {
  console.log("OK: every public table is mentioned in docs/data-model/");
  process.exit(0);
}

console.error("FAIL: tables not mentioned in docs/data-model/:\n");
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  ${v.name}`);
}
console.error("\nFix: add a section about the table to the appropriate domain doc");
console.error("     under docs/data-model/ (production.md, inventory.md, sales.md, etc.).");
console.error("     Or whitelist with `-- check-data-model-docs: skip <reason>`.");
process.exit(1);
