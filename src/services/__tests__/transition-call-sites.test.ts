/**
 * Atomic Transition Call-Site Enforcement
 *
 * Walks every API route handler under src/app/api and asserts that any route
 * performing a status UPDATE on a table with registered transition side
 * effects uses the shared transactional service. Mirrors the source-walking
 * idiom of entity-configs.test.ts (which walks the app router tree).
 *
 * Why: client-side `UPDATE` followed by separate side-effect writes can commit
 * only half the operation. The shared service invokes transition_entity_atomic
 * so PostgreSQL owns rollback and retry safety.
 *
 * The side-effect table list is PARSED out of migration 00256, so registering a
 * new (table, toState) effect in `transition_entity_atomic` automatically
 * extends enforcement to API routes touching that table — no list to update
 * here, and no way for a new effect to slip past unenforced.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const MIGRATION_PATH = join(ROOT, "supabase/migrations/00256_atomic_entity_transitions.sql");
const API_ROOT = join(ROOT, "src/app/api");
/** Where request-body Zod schemas live; scanned to find status-bearing ones. */
const SCHEMA_ROOTS = ["src/lib/schemas", "src/entities"];

/**
 * Tables with registered (table, toState) side effects, parsed from migration
 * 00256's `p_table_name = '<table>'` guards.
 */
function sideEffectTables(): string[] {
  const migration = readFileSync(MIGRATION_PATH, "utf8");
  const matches = migration.matchAll(/p_table_name\s*=\s*'([a-z_]+)'/g);
  return [...new Set([...matches].map((m) => m[1]))];
}

/** All route.ts files under src/app/api, recursively. */
function apiRouteFiles(): string[] {
  return readdirSync(API_ROOT, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name === "route.ts")
    .map((e) => join(e.parentPath, e.name));
}

/** Every .ts/.tsx file under the given repo-relative directory. */
function sourceFilesUnder(relativeDir: string): string[] {
  return readdirSync(join(ROOT, relativeDir), {
    recursive: true,
    withFileTypes: true,
  })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => join(e.parentPath, e.name));
}

/**
 * Names of exported `z.object({ ... })` schemas that declare a `status` field.
 *
 * A route that pipes one of these into `.update(<identifier>)` writes the state
 * column even though no `status` literal appears at the call site — and, worse,
 * a `.default()` on that field survives `.partial()`, so the state column is
 * written even when the client never sent one. Discovered by scanning rather
 * than listed, so a new status-bearing schema is covered automatically.
 */
export function statusBearingSchemas(): Set<string> {
  const found = new Set<string>();
  // `[\s\S]*?^\}\)` stops at the first column-0 `})`, so nested z.object(...)
  // literals inside a schema (which are indented) do not truncate the body.
  const declaration = /export const (\w+)\s*=\s*z\.object\(\{([\s\S]*?)^\}\)/gm;
  for (const dir of SCHEMA_ROOTS) {
    for (const file of sourceFilesUnder(dir)) {
      const source = readFileSync(file, "utf8");
      for (const [, name, fields] of source.matchAll(declaration)) {
        if (/^\s+status:/m.test(fields)) found.add(name);
      }
    }
  }
  return found;
}

/**
 * Identifiers in `source` bound to a validated body whose schema carries a
 * `status` field — e.g. `const body = await validateBody(batchSchema.partial(), request)`.
 * A chain that explicitly drops the field (`.omit({ status: true })`) is not
 * status-bearing and is excluded.
 */
function statusBearingBodyIdentifiers(
  source: string,
  statusSchemas: Set<string>
): string[] {
  const identifiers: string[] = [];
  const bound = /const\s+(\w+)\s*=\s*await\s+validateBody\(\s*([\s\S]*?),\s*request\s*\)/g;
  for (const [, identifier, schemaExpression] of source.matchAll(bound)) {
    const base = schemaExpression.match(/^(\w+)/)?.[1];
    if (!base || !statusSchemas.has(base)) continue;
    if (/\.omit\(\s*\{[^}]*\bstatus\s*:/.test(schemaExpression)) continue;
    identifiers.push(identifier);
  }
  return identifiers;
}

/**
 * The chained expression following each `.from("<table>")`, up to the end of
 * its statement. Scoping to the chain keeps a route that merely *reads* one
 * table and updates another (e.g. the recipes route's batch-reference count
 * guard) from being attributed to the table it only read.
 */
function chainsFromTable(source: string, table: string): string[] {
  const marker = `.from("${table}")`;
  const chains: string[] = [];
  for (
    let index = source.indexOf(marker);
    index !== -1;
    index = source.indexOf(marker, index + marker.length)
  ) {
    const start = index + marker.length;
    const end = source.indexOf(";", start);
    chains.push(source.slice(start, end === -1 ? source.length : end));
  }
  return chains;
}

/**
 * Does this source write `<table>.status` outside the atomic service?
 *
 * Two shapes count: the inline literal `.update({ status: ... })`, and the
 * indirect `.update(<identifier>)` where the identifier holds a validated body
 * from a status-bearing schema. The indirect form is why #601 shipped — the
 * original detector only matched the literal.
 */
export function performsStatusTransition(
  source: string,
  table: string,
  statusSchemas: Set<string>
): boolean {
  const identifiers = statusBearingBodyIdentifiers(source, statusSchemas);
  return chainsFromTable(source, table).some(
    (chain) =>
      /\.update\(\s*\{\s*status\b/.test(chain) ||
      identifiers.some((identifier) =>
        new RegExp(`\\.update\\(\\s*${identifier}\\s*\\)`).test(chain)
      )
  );
}

const UI_ENTRY_POINTS = [
  "src/components/universal/entity-detail-unified.tsx",
  "src/components/universal/entity-data-table.tsx",
  "src/app/(app)/production/batches/[id]/batch-detail-client.tsx",
  "src/app/(app)/production/batches/batches-client.tsx",
  "src/components/domain/order/pick-list-items.tsx",
  "src/components/domain/packaging/packaging-completion-review.tsx",
  "src/components/domain/packaging/packaging-batch-dialog.tsx",
  "src/components/domain/brew/brew-log-completion-dialog.tsx",
  "src/app/(app)/production/brew-logs/[id]/page.tsx",
];

describe("Atomic transition call sites", () => {
  const tables = sideEffectTables();
  const routes = apiRouteFiles();
  const statusSchemas = statusBearingSchemas();

  it("sanity: registry tables parsed and API routes found", () => {
    // Guards the parse itself — a regex regression would silently yield [] and
    // make the enforcement test below pass vacuously.
    expect(tables).toEqual(
      expect.arrayContaining([
        "batches",
        "packaging_sessions",
        "pick_lists",
        "orders",
        "deliveries",
      ])
    );
    expect(routes.length).toBeGreaterThan(0);
  });

  it("the detector recognises the indirect `.update(<validated body>)` form", () => {
    // Both declare a `status` field, so both must be discovered by the scan.
    expect(statusSchemas).toContain("batchSchema");
    expect(statusSchemas).toContain("recipeSchema");
    // A schema with no state column must not be treated as one.
    expect(statusSchemas).not.toContain("brewSessionLogSchema");

    const indirect = `
      const body = await validateBody(batchSchema.partial(), request);
      await supabase.from("batches").update(body).eq("id", id);
    `;
    expect(performsStatusTransition(indirect, "batches", statusSchemas)).toBe(true);

    const stripped = `
      const body = await validateBody(batchUpdateSchema, request);
      await supabase.from("batches").update(body).eq("id", id);
    `;
    expect(performsStatusTransition(stripped, "batches", statusSchemas)).toBe(false);

    const inlineLiteral = `await supabase.from("batches").update({ status: "completed" })`;
    expect(performsStatusTransition(inlineLiteral, "batches", statusSchemas)).toBe(true);

    const otherTable = `
      const body = await validateBody(batchSchema.partial(), request);
      await supabase.from("brews").update(body).eq("id", id);
    `;
    expect(performsStatusTransition(otherTable, "batches", statusSchemas)).toBe(false);
  });

  it("every API route that transitions a side-effect table uses the atomic service", () => {
    const violations: string[] = [];
    for (const route of routes) {
      const source = readFileSync(route, "utf8");
      for (const table of tables) {
        if (
          performsStatusTransition(source, table, statusSchemas) &&
          !source.includes("entityService.transition") &&
          !source.includes("transition_entity_atomic")
        ) {
          violations.push(`${route.slice(ROOT.length + 1)} (table: ${table})`);
        }
      }
    }
    expect(
      violations,
      `Status transitions bypassing the atomic command:\n${violations.join("\n")}\n` +
        `Call entityService.transition so status and side effects share one transaction.`
    ).toEqual([]);
  });

  it("all interactive transition entry points use the shared atomic service", () => {
    for (const relativePath of UI_ENTRY_POINTS) {
      const source = readFileSync(join(ROOT, relativePath), "utf8");
      expect(source, relativePath).toContain("entityService.transition");
      expect(source, relativePath).not.toContain("runTransitionSideEffects");
    }
  });

  it("the database command covers every registered critical side-effect family", () => {
    const migration = readFileSync(MIGRATION_PATH, "utf8");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION transition_entity_atomic");
    expect(migration).toContain("SECURITY INVOKER");
    expect(migration).toContain("SET search_path = public");
    expect(migration).toContain("UPDATE vessels");
    expect(migration).toContain("UPDATE allocations");
    expect(migration).toContain("PERFORM transition_entity_atomic(");
  });
});
