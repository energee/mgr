/**
 * Transition Side-Effect Call-Site Enforcement
 *
 * Walks every API route handler under src/app/api and asserts that any route
 * performing a status UPDATE on a table with registered transition side
 * effects also calls runTransitionSideEffects. Mirrors the source-walking
 * idiom of entity-configs.test.ts (which walks the app router tree).
 *
 * Why: transition-side-effects.ts exists because the batch-completion effect
 * was once duplicated in only 2 of 4 UI transition paths, silently skipping
 * ingredient consumption. API routes are a fifth path — backlog #7 (PR #336
 * review) found api/batches/[id]/transfer updating batches.status without
 * running the registry. This test makes the next bypass fail CI.
 *
 * The side-effect table list is parsed from transition-side-effects.ts itself
 * (`table === "<name>"` matches), so registering a new effect automatically
 * extends enforcement to routes touching that table.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const REGISTRY_PATH = join(ROOT, "src/services/transition-side-effects.ts");
const API_ROOT = join(ROOT, "src/app/api");

/** Tables with registered (table, toState) side effects, parsed from source. */
function sideEffectTables(): string[] {
  const source = readFileSync(REGISTRY_PATH, "utf8");
  const tables = new Set<string>();
  for (const match of source.matchAll(/table === "([^"]+)"/g)) {
    tables.add(match[1]);
  }
  return [...tables];
}

/** All route.ts files under src/app/api, recursively. */
function apiRouteFiles(dir: string = API_ROOT): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...apiRouteFiles(full));
    } else if (entry.name === "route.ts") {
      files.push(full);
    }
  }
  return files;
}

/** Does this source perform `.from("<table>") ... .update({ status ...` ? */
function performsStatusTransition(source: string, table: string): boolean {
  return (
    source.includes(`.from("${table}")`) && /\.update\(\s*\{\s*status\b/.test(source)
  );
}

describe("Transition side-effect call sites (API routes)", () => {
  const tables = sideEffectTables();
  const routes = apiRouteFiles();

  it("sanity: registry tables parsed and API routes found", () => {
    expect(tables).toEqual(
      expect.arrayContaining(["batches", "packaging_sessions", "pick_lists"])
    );
    expect(routes.length).toBeGreaterThan(0);
  });

  it("every API route that transitions a side-effect table calls runTransitionSideEffects", () => {
    const violations: string[] = [];
    for (const route of routes) {
      const source = readFileSync(route, "utf8");
      for (const table of tables) {
        if (
          performsStatusTransition(source, table) &&
          !source.includes("runTransitionSideEffects")
        ) {
          violations.push(`${route.slice(ROOT.length + 1)} (table: ${table})`);
        }
      }
    }
    expect(
      violations,
      `Status transitions bypassing the side-effect registry:\n${violations.join("\n")}\n` +
        `Call runTransitionSideEffects(supabase, table, ids, toState) after the UPDATE succeeds.`
    ).toEqual([]);
  });
});
