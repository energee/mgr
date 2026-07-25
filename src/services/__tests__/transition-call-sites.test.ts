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

/** Does this source perform `.from("<table>") ... .update({ status ...` ? */
function performsStatusTransition(source: string, table: string): boolean {
  return (
    source.includes(`.from("${table}")`) && /\.update\(\s*\{\s*status\b/.test(source)
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

  it("every API route that transitions a side-effect table uses the atomic service", () => {
    const violations: string[] = [];
    for (const route of routes) {
      const source = readFileSync(route, "utf8");
      for (const table of tables) {
        if (
          performsStatusTransition(source, table) &&
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
