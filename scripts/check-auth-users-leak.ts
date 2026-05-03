#!/usr/bin/env bun
/**
 * scripts/check-auth-users-leak.ts
 *
 * Fails (exit 1) if the *latest* definition of any view or function in
 * `supabase/migrations/` references `auth.users` (in code, not comments).
 *
 * The check is migration-history-aware: when migration 00156 replaces a
 * view originally defined in 00006, only the latest body is inspected.
 * Files are processed in lexical order, which matches Supabase's apply
 * order (`00XXX_…`). For views and functions, "latest" means the most
 * recent `CREATE [OR REPLACE] VIEW|FUNCTION` keyed by name (functions
 * are keyed by name only — overloaded signatures coalesce, which is
 * conservative).
 *
 * Whitelist: per-line skip comment of the form
 *   `-- check-auth-users-leak: skip <reason>`
 * placed directly above the offending line is respected.
 *
 * Rationale: docs/agents/db-security.md (DEC-SEC-002).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";

type Definition = {
  kind: "view" | "function";
  name: string;
  file: string;
  startLine: number;
  body: string[]; // lines including the CREATE statement
};

function* walk(dir: string): Generator<string> {
  const entries = readdirSync(dir).sort();
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (full.endsWith(".sql")) yield full;
  }
}

const latestDef = new Map<string, Definition>();

for (const file of walk(MIGRATIONS_DIR)) {
  const lines = readFileSync(file, "utf8").split("\n");

  let state: "idle" | "in_view" | "in_function" = "idle";
  let current: Definition | null = null;
  let dollarTagBalance = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (state === "idle") {
      const viewMatch = line.match(
        /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/i,
      );
      const fnMatch = line.match(
        /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w."]+)/i,
      );

      if (viewMatch) {
        state = "in_view";
        current = {
          kind: "view",
          name: viewMatch[1],
          file,
          startLine: i + 1,
          body: [line],
        };
      } else if (fnMatch) {
        state = "in_function";
        dollarTagBalance = 0;
        current = {
          kind: "function",
          name: fnMatch[1],
          file,
          startLine: i + 1,
          body: [line],
        };
      }
      continue;
    }

    if (state === "in_view" && current) {
      current.body.push(line);
      // View ends at first top-level ;
      if (/;\s*(--.*)?$/.test(line)) {
        latestDef.set(`view:${current.name}`, current);
        state = "idle";
        current = null;
      }
      continue;
    }

    if (state === "in_function" && current) {
      current.body.push(line);
      // Track $$ pairs. A function body is wrapped in $$ ... $$.
      const dollars = (line.match(/\$\$/g) ?? []).length;
      dollarTagBalance += dollars;
      // Function definition ends after the closing $$ followed by `LANGUAGE` and ;,
      // or after a CREATE FUNCTION ... LANGUAGE ... ; without $$.
      if (
        (dollarTagBalance >= 2 && /\$\$\s*(LANGUAGE|;)/i.test(line)) ||
        /;\s*$/.test(line.replace(/--.*$/, "")) && dollarTagBalance === 0 && current.body.length > 1
      ) {
        latestDef.set(`function:${current.name}`, current);
        state = "idle";
        current = null;
      }
    }
  }
}

type Hit = { def: Definition; line: number; snippet: string };
const hits: Hit[] = [];

for (const def of latestDef.values()) {
  for (let j = 0; j < def.body.length; j++) {
    const line = def.body[j];
    const codePart = line.replace(/--.*$/, "");
    if (!/\bauth\.users\b/i.test(codePart)) continue;

    const prevLine = def.body[j - 1] ?? "";
    if (/check-auth-users-leak:\s*skip/i.test(prevLine)) continue;

    hits.push({
      def,
      line: def.startLine + j,
      snippet: line.trim(),
    });
  }
}

if (hits.length === 0) {
  console.log("OK: no auth.users references in the latest definition of any view or function");
  process.exit(0);
}

console.error("FAIL: auth.users referenced in the latest definition of:\n");
for (const hit of hits) {
  console.error(
    `  ${hit.def.file}:${hit.line}  [${hit.def.kind} ${hit.def.name}]  ${hit.snippet}`,
  );
}
console.error("\nFix:");
console.error("  - For views: cache user info in your own table (e.g., user_profiles.email).");
console.error("  - For server-side admin functions (SECURITY DEFINER, IDs only):");
console.error("    add `-- check-auth-users-leak: skip <reason>` above the line.");
console.error("See docs/agents/db-security.md (DEC-SEC-002).");
process.exit(1);
