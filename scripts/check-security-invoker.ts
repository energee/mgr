#!/usr/bin/env bun
/**
 * scripts/check-security-invoker.ts
 *
 * Fails (exit 1) if any view in `supabase/migrations/` is left without
 * `security_invoker = true` after the full migration history has been
 * replayed. The check is migration-history-aware:
 *
 *   - A `CREATE [OR REPLACE] [MATERIALIZED] VIEW name [WITH (... security_invoker = true ...)]`
 *     defines a view; the WITH clause sets the option.
 *   - A later `ALTER VIEW name SET (security_invoker = true)` flips the
 *     option on for an existing view.
 *   - A later `CREATE OR REPLACE VIEW name WITH (security_invoker = true)`
 *     also flips it on (replaces the definition, with the option set).
 *
 * The view is compliant iff at least one of those statements appears in
 * any migration file. Files are processed in lexical order, which matches
 * Supabase's apply order (`00XXX_…`).
 *
 * Whitelist: a view that intentionally runs as definer can add
 * `-- check-security-invoker: skip <reason>` on the line directly above
 * its CREATE VIEW.
 *
 * Rationale: docs/agents/db-security.md (DEC-SEC-001).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";

type ViewState = {
  firstSeenFile: string;
  firstSeenLine: number;
  secured: boolean;
  skipped: boolean;
};

function* walk(dir: string): Generator<string> {
  const entries = readdirSync(dir).sort();
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (full.endsWith(".sql")) yield full;
  }
}

function hasInvokerWithClause(text: string): boolean {
  return /WITH\s*\([^)]*security_invoker\s*=\s*(?:true|on|1)/i.test(text);
}

const views = new Map<string, ViewState>();

for (const file of walk(MIGRATIONS_DIR)) {
  const lines = readFileSync(file, "utf8").split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // CREATE [OR REPLACE] [MATERIALIZED] VIEW name [WITH (...)]
    const createMatch = line.match(
      /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/i,
    );
    if (createMatch) {
      const name = createMatch[1];
      // The view's WITH (...) reloptions clause (if present) appears between
      // the view name and the `AS <query>` keyword. Scan the header until we
      // hit `AS` so views with long column-alias lists are handled correctly.
      // Fall back to a 200-line cap to bound the scan on pathological input.
      const headerLines: string[] = [];
      const maxScan = Math.min(lines.length, i + 200);
      for (let j = i; j < maxScan; j++) {
        headerLines.push(lines[j]);
        if (/\bAS\b/i.test(lines[j].replace(/--.*$/, ""))) break;
      }
      const lookahead = headerLines.join(" ");
      const prevLine = lines[i - 1] ?? "";
      const skipped = /check-security-invoker:\s*skip/i.test(prevLine);
      const secured = hasInvokerWithClause(lookahead);

      // CREATE [OR REPLACE]: latest declaration wins for `secured`. PG 16
      // empirically clears reloptions on un-WITH'd CREATE OR REPLACE, so an
      // earlier secured definition can be silently downgraded by a later
      // CREATE that omits the WITH clause. Use replacement, not OR.
      const existing = views.get(name);
      views.set(name, {
        firstSeenFile: existing?.firstSeenFile ?? file,
        firstSeenLine: existing?.firstSeenLine ?? i + 1,
        secured: secured || skipped,
        skipped: skipped || (existing?.skipped ?? false),
      });
      continue;
    }

    // ALTER VIEW name SET (security_invoker = true)
    const alterMatch = line.match(
      /^\s*ALTER\s+VIEW\s+(?:IF\s+EXISTS\s+)?([\w."]+)\s+SET\s*\([^)]*security_invoker\s*=\s*(?:true|on|1)/i,
    );
    if (alterMatch) {
      const name = alterMatch[1];
      const existing = views.get(name);
      if (existing) {
        existing.secured = true;
      }
      // ALTER VIEW on a view we haven't seen yet is unusual but harmless:
      // record it so a later CREATE will be considered secured.
      else {
        views.set(name, {
          firstSeenFile: file,
          firstSeenLine: i + 1,
          secured: true,
          skipped: false,
        });
      }
    }
  }
}

const violations = Array.from(views.entries())
  .filter(([, state]) => !state.secured)
  .map(([name, state]) => ({ name, ...state }));

if (violations.length === 0) {
  console.log("OK: every view in supabase/migrations/ ends up with security_invoker = true");
  process.exit(0);
}

console.error("FAIL: views without security_invoker = true after full migration replay:\n");
for (const v of violations) {
  console.error(`  ${v.firstSeenFile}:${v.firstSeenLine}  ${v.name}`);
}
console.error("\nFix options:");
console.error("  1. Add `WITH (security_invoker = true)` to the CREATE VIEW.");
console.error("  2. Add a corrective migration: `ALTER VIEW <name> SET (security_invoker = true);`");
console.error("  3. Whitelist intentionally-definer views with `-- check-security-invoker: skip <reason>`.");
console.error("See docs/agents/db-security.md (DEC-SEC-001).");
process.exit(1);
