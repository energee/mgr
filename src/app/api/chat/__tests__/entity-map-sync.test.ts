/**
 * coreRegistry ↔ Schema Sync Test
 *
 * The chat API route cannot import the full entity registry (entity configs
 * import React client components), so it reads from `coreRegistry`
 * (src/entities/cores.ts) — a React-free map assembled from each entity's
 * `core.ts` module. `core-registry.test.ts` pins the registry's composition
 * (which keys exist, defaultSort presence); this test guards a different
 * invariant: that the *column names* the chat read path consumes from each
 * core actually exist on the relation the entity service will query.
 *
 * Because every `core.ts` is also the single source of truth for the full
 * `EntityConfig` (the chat map is no longer hand-duplicated), core-vs-registry
 * drift is now structurally impossible — there is one definition. What can
 * still drift is a core referencing a column that the generated Supabase types
 * say doesn't exist on `viewTable ?? table` (the yeast_strain keyFields bug
 * class: a misnamed field silently yields `undefined` in the AI context
 * summary instead of erroring). This test parses the generated types and
 * verifies:
 *
 * - the queried relation (viewTable ?? table) exists in the generated schema,
 * - the core's defaultSort column exists on that relation,
 * - keyFields columns exist on that relation,
 * - detailHeader field names (title/subtitle/badge) exist on that relation.
 *
 * If this test fails after editing an entity's core.ts, fix the field name in
 * core.ts (or the view) so the chat read path resolves a real column.
 */

import { describe, it, expect, vi } from "vitest";
import { parseSchemaColumns } from "@/test/schema-columns";

// Mirrors core-registry.test.ts: a few cores transitively touch the Supabase
// browser client (enum-value/core.ts → @/lib/supabase/client). Stub it at
// import time so the registry stays importable in the Vitest environment.
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ data: [], error: null }),
    }),
  }),
}));

import { coreRegistry } from "@/entities/cores";

// =============================================================================
// Schema column parsing (generated Supabase types)
// =============================================================================

/**
 * Relation name → set of Row column names, parsed from the generated
 * src/types/supabase.ts (Tables and Views). Used to verify that the columns
 * each core sorts/reads on actually exist on the queried relation. The parser
 * is shared with src/entities/__tests__/section-fields-schema-sync.test.ts,
 * which runs the same class of check over editable section fields (#612).
 */

const schemaColumns = parseSchemaColumns();

/** All cores resolved from the server-safe registry. */
const cores = Array.from(coreRegistry.values());

/**
 * Relations that a `core.ts` legitimately queries but which are absent from the
 * generated `src/types/supabase.ts`. `keg_transactions_with_details` is a real
 * database view (created in migration 00032, recreated in 00155) that the
 * generated types simply haven't picked up yet. The column-existence tests
 * below already skip relations they can't parse; this set lets the
 * relation-existence assertion tolerate the same known gap rather than failing
 * on a view that genuinely exists.
 */
const UNTYPED_BUT_REAL_RELATIONS = new Set(["keg_transactions_with_details"]);

// =============================================================================
// Tests
// =============================================================================

describe("coreRegistry ↔ schema sync", () => {
  it("sanity: registry and schema parsing produced data", () => {
    expect(coreRegistry.size).toBeGreaterThan(0);
    // Guard against a supabase-gen format change silently breaking the regex
    // parser: known tables AND a known view must have parsed with their
    // well-known columns, not just `size > 0`.
    for (const relation of ["batches", "orders", "inventory_lots", "batches_with_brew_info"]) {
      expect(schemaColumns.has(relation), `relation '${relation}' did not parse from src/types/supabase.ts`).toBe(true);
      expect(schemaColumns.get(relation)!.has("id"), `relation '${relation}' parsed without an 'id' column`).toBe(true);
    }
    expect(schemaColumns.get("batches")!.has("batch_code")).toBe(true);
    expect(schemaColumns.get("orders")!.has("order_number")).toBe(true);
  });

  it("core entry name matches its registry key", () => {
    for (const [key, core] of coreRegistry.entries()) {
      expect(core.name, `key '${key}' has mismatched name`).toBe(key);
    }
  });

  // Reference tables with no entity config (keg_type, package_type) are no
  // longer in the registry, so every core here has a queried relation we can
  // check. The two registry-less reference tables were environment-dependent
  // (see migration 00155's IF EXISTS guard) and are intentionally absent.
  it("the queried relation (viewTable ?? table) exists in the generated schema", () => {
    const violations: string[] = [];
    for (const core of cores) {
      const relation = core.viewTable ?? core.table;
      if (!schemaColumns.has(relation) && !UNTYPED_BUT_REAL_RELATIONS.has(relation)) {
        violations.push(`${core.name}: relation '${relation}' not found in src/types/supabase.ts`);
      }
      if (core.viewTable && !schemaColumns.has(core.table)) {
        violations.push(`${core.name}: base table '${core.table}' not found in src/types/supabase.ts`);
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("defaultSort column exists on the queried relation", () => {
    const violations: string[] = [];
    for (const core of cores) {
      if (!core.defaultSort) continue;
      const relation = core.viewTable ?? core.table;
      const cols = schemaColumns.get(relation);
      if (!cols) continue; // covered by the relation-existence test above
      const column = String(core.defaultSort.column);
      if (!cols.has(column)) {
        violations.push(`${core.name}: defaultSort column '${column}' does not exist on '${relation}'`);
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  // The chat route reads detailHeader/keyFields off raw records fetched from
  // (viewTable ?? table), so a misnamed field silently yields `undefined` in
  // the AI context summary instead of erroring (the yeast_strain keyFields bug
  // class). Verify each named field is a real column on the queried relation.
  it("keyFields columns exist on the queried relation", () => {
    const violations: string[] = [];
    for (const core of cores) {
      if (!core.keyFields?.length) continue;
      const relation = core.viewTable ?? core.table;
      const cols = schemaColumns.get(relation);
      if (!cols) continue; // covered by the relation-existence test above
      for (const field of core.keyFields) {
        if (!cols.has(String(field))) {
          violations.push(`${core.name}: keyFields column '${String(field)}' does not exist on '${relation}'`);
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("detailHeader fields (title/subtitle/badge) exist on the queried relation", () => {
    const violations: string[] = [];
    for (const core of cores) {
      if (!core.detailHeader) continue;
      const relation = core.viewTable ?? core.table;
      const cols = schemaColumns.get(relation);
      if (!cols) continue; // covered by the relation-existence test above
      for (const [part, field] of Object.entries(core.detailHeader)) {
        if (field !== undefined && !cols.has(String(field))) {
          violations.push(`${core.name}: detailHeader.${part} '${String(field)}' does not exist on '${relation}'`);
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});
