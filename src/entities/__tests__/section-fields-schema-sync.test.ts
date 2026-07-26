/**
 * Editable section fields ↔ read-relation column sync (issue #612).
 *
 * `EntityDetailUnified` reads a record from `viewTable ?? table`
 * (`detail-query-options.ts`) but writes to `table`. When an editable section
 * field names a column that the READ relation does not expose, the record
 * carries no value for it, `buildDefaultValues` seeds `""`, and the save-time
 * `""`→`null` pass writes `NULL` over whatever the base table held — silent
 * data loss on every save, including saves that never touched the field.
 *
 * That is exactly how `packaging_session.default_bin_id` was lost: the view
 * `packaging_sessions_with_summary` was created with `SELECT ps.*`, Postgres
 * froze the column list at creation time, and migration 00219's later
 * `ADD COLUMN default_bin_id` never reached the view (fixed by 00278).
 *
 * This test generalizes the guard: for every registered entity, every editable
 * section field must exist on the Row of the relation the detail page reads.
 * `entity-map-sync.test.ts` performs the same class of check for `defaultSort`,
 * `keyFields` and `detailHeader`, but reads the server-safe `*Core` modules —
 * sections live in `presentation.tsx`, so this file imports the assembled
 * registry instead.
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import type { EntityConfig } from "@/types/entity";
import { parseSchemaColumns } from "@/test/schema-columns";

// Mock the Supabase client: several entity configs transitively import
// components that call createClient() at module scope.
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ data: [], error: null }),
    }),
  }),
}));

import { entityRegistry } from "@/types/entity";
import "@/entities/index";

const schemaColumns = parseSchemaColumns();

/**
 * Relations that entity configs legitimately read but which the generated
 * types do not contain. Mirrors the allow-list in
 * `src/app/api/chat/__tests__/entity-map-sync.test.ts`:
 * `keg_transactions_with_details` is a real view (00032, recreated in 00155)
 * that `supabase gen types` has not picked up.
 */
const UNTYPED_BUT_REAL_RELATIONS = new Set(["keg_transactions_with_details"]);

/**
 * `entity:field` pairs that are known-good despite not appearing on the read
 * relation in the generated types. Each entry needs a reason — an unexplained
 * entry here is the bug this test exists to catch.
 *
 * Both current entries are columns the migration chain creates but
 * `src/types/supabase.ts` has not been regenerated for; their entity types
 * hand-extend the generated Row to compensate (see the `Brand` /
 * `SalesChannel` type aliases). Neither can hit the #612 failure mode: both
 * entities read their base table, so the read and write relations are the same
 * object and cannot disagree about a column. Delete these entries when the
 * types are regenerated.
 */
const KNOWN_UNGENERATED_FIELDS = new Set<string>([
  // migration 00244 — brands.is_active
  "brand:is_active",
  // migration 00089 — sales_channels.change_request_cutoff_state
  "sales_channel:change_request_cutoff_state",
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let allEntities: EntityConfig<any>[] = [];

beforeAll(() => {
  allEntities = Array.from(entityRegistry.values());
});

describe("editable section fields ↔ read relation", () => {
  it("sanity: registry and schema parsing produced data", () => {
    expect(allEntities.length).toBeGreaterThan(0);
    for (const relation of ["batches", "packaging_sessions", "packaging_sessions_with_summary"]) {
      expect(
        schemaColumns.has(relation),
        `relation '${relation}' did not parse from src/types/supabase.ts`
      ).toBe(true);
      expect(schemaColumns.get(relation)!.has("id")).toBe(true);
    }
  });

  it("every editable section field exists on the relation the detail page reads", () => {
    const violations: string[] = [];
    for (const entity of allEntities) {
      if (!entity.sections?.length) continue;
      const relation = entity.viewTable ?? entity.table;
      if (UNTYPED_BUT_REAL_RELATIONS.has(relation)) continue;
      const cols = schemaColumns.get(relation);
      if (!cols) {
        violations.push(`${entity.name}: relation '${relation}' not found in src/types/supabase.ts`);
        continue;
      }
      // Same predicate as getEditableFieldsFromSections: a field is editable
      // when it has a `type` and is not explicitly `editable: false`. Those are
      // exactly the fields the ""→null save pass rewrites.
      const editable = entity.sections
        .flatMap((s) => s.fields ?? [])
        .filter((f) => f.type && f.editable !== false);
      for (const field of editable) {
        const name = String(field.name);
        if (KNOWN_UNGENERATED_FIELDS.has(`${entity.name}:${name}`)) continue;
        if (!cols.has(name)) {
          violations.push(`${entity.name}: section field '${name}' does not exist on '${relation}'`);
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});
