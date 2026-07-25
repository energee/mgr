/**
 * Static guard against the recurring "table key vs view key" cache bug
 * (issues #560, #613, #614, #615).
 *
 * Entities that declare a `viewTable` are read through the view: the universal
 * list/detail query builders key off `viewTable ?? table`, so their caches live
 * under the *view* name. A mutation that invalidates only the base-table name
 * therefore refreshes nothing, and the UI silently serves pre-mutation data.
 * `entityKeys.all()` takes a plain `string`, so neither TypeScript nor the
 * existing ESLint rule can catch it — hence this source scan.
 *
 * Two rules, both cheap text checks over `src/`:
 *   A. Every literal table name handed to `entityKeys.*` must be a real table
 *      or view of some entity (or an explicitly allowlisted ad-hoc relation).
 *      Catches typo'd / renamed keys that match no query at all.
 *   B. Any `invalidateQueries` naming the base table of an entity that has a
 *      `viewTable` must invalidate the view name somewhere in the same file.
 *      Catches the #560/#615 shape.
 *
 * If this test fails, fix the call site — do not add to the allowlists unless
 * the name genuinely is a relation with no entity config.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// enum-value/core.ts pulls the Supabase browser client, which validates env at
// import time; only the static table/viewTable metadata is needed here.
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

import { coreRegistry } from "@/entities/cores";

const SRC_ROOT = join(process.cwd(), "src");

/**
 * Relations queried ad hoc that have no entity config, so they have no
 * table/viewTable pair to check. Keep this list short and justified.
 */
const NON_ENTITY_RELATIONS = new Set([
  "order_items_for_review", // review-only projection assembled client-side
  "yeast_pitch_events", // child rows of yeast_pitches, no entity config
  "batch_blends", // child rows of batches, no entity config
  "keg_owner_deposits", // real table, queried only by keg-owner-deposits-editor
]);

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      sourceFiles(full, acc);
      continue;
    }
    if (/\.tsx?$/.test(entry)) acc.push(full);
  }
  return acc;
}

const FILES = sourceFiles(SRC_ROOT).filter(
  // query-keys.ts itself only documents the factory in comments/examples.
  (file) => !file.endsWith(join("lib", "query-keys.ts")),
);

/** All names any entity is read or written under. */
const ENTITY_TABLES = new Set<string>();
/** base table -> view table, for entities that have a view. */
const VIEW_BY_TABLE = new Map<string, string>();

for (const core of coreRegistry.values()) {
  ENTITY_TABLES.add(core.table);
  if (core.viewTable) {
    ENTITY_TABLES.add(core.viewTable);
    VIEW_BY_TABLE.set(core.table, core.viewTable);
  }
}

const ANY_ENTITY_KEY_CALL =
  /entityKeys\.(?:all|list|detail|pagedList|related|timeline)\(\s*"([a-z_]+)"/g;

const INVALIDATION_CALL =
  /invalidateQueries\(\s*\{\s*queryKey:\s*entityKeys\.(?:all|list)\(\s*"([a-z_]+)"/g;

function relativePath(file: string) {
  return file.slice(process.cwd().length + 1);
}

describe("entityKeys table names", () => {
  it("only names real entity tables, views, or allowlisted relations", () => {
    const unknown: string[] = [];

    for (const file of FILES) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(ANY_ENTITY_KEY_CALL)) {
        const name = match[1];
        if (ENTITY_TABLES.has(name) || NON_ENTITY_RELATIONS.has(name)) continue;
        unknown.push(`${relativePath(file)}: entityKeys(…"${name}")`);
      }
    }

    expect(unknown).toEqual([]);
  });

  it("invalidates the view key alongside the base table for viewed entities", () => {
    const violations: string[] = [];

    for (const file of FILES) {
      const text = readFileSync(file, "utf8");
      const invalidatedBaseTables = new Set(
        Array.from(text.matchAll(INVALIDATION_CALL), (m) => m[1]),
      );

      for (const table of invalidatedBaseTables) {
        const view = VIEW_BY_TABLE.get(table);
        if (!view) continue;
        // The view may be invalidated through entityKeys.all/list/detail —
        // any mention of the view name in an entityKeys call counts.
        if (text.includes(`entityKeys.all("${view}")`)) continue;
        if (text.includes(`entityKeys.list("${view}")`)) continue;
        violations.push(
          `${relativePath(file)}: invalidates "${table}" but never "${view}"`,
        );
      }
    }

    expect(violations).toEqual([]);
  });
});
