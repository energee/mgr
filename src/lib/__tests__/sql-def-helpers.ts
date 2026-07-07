/**
 * Shared helpers for structural SQL regression tests.
 *
 * The repo has no pgTAP/local-Postgres harness, so schema-level contracts are
 * pinned by parsing the migration chain and asserting on the text of the
 * LATEST definition of a function or view (highest-numbered migration wins,
 * matching Postgres apply order — the same idiom as state-machines.test.ts
 * and analyze-batch-performance.test.ts). These are structural assertions,
 * not behavioral DB tests; upgrade to a DB-backed harness if one is ever
 * introduced.
 */
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";

const MIGRATIONS_DIR = resolve(__dirname, "../../../supabase/migrations");

/** Migration filenames in apply order (lexical == apply for 00XXX prefixes). */
function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/** Last regex match for `re` across the migration chain, or null. */
function latestMatch(re: RegExp): string | null {
  let body: string | null = null;
  for (const f of migrationFiles()) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, f), "utf-8");
    const m = sql.match(re);
    if (m) body = m[2] ?? m[1]; // keep overwriting; last (highest-sorted) wins
  }
  return body;
}

/**
 * Body of the latest CREATE OR REPLACE FUNCTION of `fnName`, or null.
 * Handles an optional `public.` schema qualifier and any dollar-quote tag
 * ($$ ... $$ or $function$ ... $function$, as pg_dump-style captures use).
 */
export function latestFunctionBody(fnName: string): string | null {
  return latestMatch(
    new RegExp(
      `CREATE OR REPLACE FUNCTION (?:public\\.)?${fnName}\\b[\\s\\S]*?\\$(\\w*)\\$([\\s\\S]*?)\\$\\1\\$`,
    ),
  );
}

/**
 * Body (the SELECT after AS) of the latest CREATE [OR REPLACE] VIEW of
 * `viewName`, or null. Assumes the view body contains no embedded `;`
 * (true for every view in this chain).
 */
export function latestViewBody(viewName: string): string | null {
  return latestMatch(
    new RegExp(
      `CREATE (?:OR REPLACE )?VIEW (?:public\\.)?${viewName}\\b[\\s\\S]*?\\bAS\\b([\\s\\S]*?);`,
    ),
  );
}
