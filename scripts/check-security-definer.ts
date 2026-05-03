#!/usr/bin/env bun
/**
 * scripts/check-security-definer.ts
 *
 * Fails (exit 1) if any CREATE FUNCTION uses `SECURITY DEFINER` without an
 * explicit `-- security-definer: justified <reason>` comment in the
 * function definition (within the body or directly above CREATE).
 *
 * Rationale: SECURITY DEFINER bypasses caller RLS and runs with the
 * function owner's privileges. Every use should be a deliberate,
 * documented choice — not a default. This check is the audit trail.
 *
 * Whitelist: justification comments are the whitelist. Either form works:
 *   -- security-definer: justified <reason>      (line above CREATE)
 *   -- security-definer: justified <reason>      (inline in body)
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";
const ALLOWLIST_PATH = "scripts/check-security-definer.allowlist.txt";

const allowlist = new Set<string>(
  existsSync(ALLOWLIST_PATH)
    ? readFileSync(ALLOWLIST_PATH, "utf8")
        .split("\n")
        .map((l) => l.replace(/#.*$/, "").trim())
        .filter(Boolean)
    : [],
);

type Definition = {
  name: string;
  file: string;
  startLine: number;
  body: string[];
  startLineContextPrev: string;
};

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (full.endsWith(".sql")) yield full;
  }
}

const latest = new Map<string, Definition>();

for (const file of walk(MIGRATIONS_DIR)) {
  const lines = readFileSync(file, "utf8").split("\n");
  let state: "idle" | "in_function" = "idle";
  let current: Definition | null = null;
  let dollarBalance = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (state === "idle") {
      const m = line.match(/^\s*CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w."]+)/i);
      if (m) {
        state = "in_function";
        dollarBalance = 0;
        current = {
          name: m[1],
          file,
          startLine: i + 1,
          body: [line],
          startLineContextPrev: lines[i - 1] ?? "",
        };
      }
      continue;
    }

    if (current) current.body.push(line);

    const dollars = (line.match(/\$\$/g) ?? []).length;
    dollarBalance += dollars;

    if (
      (dollarBalance >= 2 && /\$\$\s*(LANGUAGE|;)/i.test(line)) ||
      (/;\s*$/.test(line.replace(/--.*$/, "")) && dollarBalance === 0 && current && current.body.length > 1)
    ) {
      if (current) latest.set(current.name, current);
      state = "idle";
      current = null;
    }
  }
}

const violations: Definition[] = [];

for (const def of latest.values()) {
  const fullBody = def.body.join("\n");
  if (!/SECURITY\s+DEFINER\b/i.test(fullBody)) continue;

  const bareName = def.name.replace(/^public\./, "").replace(/"/g, "");
  if (allowlist.has(bareName)) continue;

  const justified =
    /security-definer:\s*justified/i.test(def.startLineContextPrev) ||
    /security-definer:\s*justified/i.test(fullBody);

  if (!justified) violations.push(def);
}

if (violations.length === 0) {
  console.log("OK: every SECURITY DEFINER function has a justification comment");
  process.exit(0);
}

console.error("FAIL: SECURITY DEFINER functions without justification:\n");
for (const v of violations) {
  console.error(`  ${v.file}:${v.startLine}  ${v.name}`);
}
console.error("\nFix: add `-- security-definer: justified <reason>` above CREATE,");
console.error("     or as a comment inside the function body. Reason should explain");
console.error("     why caller-RLS bypass is correct (e.g., 'broadcast notification");
console.error("     to all users — IDs only, no leak').");
console.error("");
console.error(`Allowlist: pre-harness functions are grandfathered in ${ALLOWLIST_PATH}.`);
console.error("           Do NOT add new entries there — use inline justification instead.");
process.exit(1);
