/**
 * `supplier_catalog` revision trail — migration 00282 (#549).
 *
 * 00252_merge_duplicate_suppliers.sql deleted duplicate-loser catalog rows
 * without carrying their `is_preferred` flag (fixed by #494, but only for
 * fresh replays). The already-lost flags are unrecoverable because nothing
 * recorded the deleted rows: `supplier_catalog` is seeded by no migration, the
 * MongoDB sync writes only `suppliers`, and `entity_revisions` had no trigger
 * on it. 00282 attaches the shared `log_entity_revision()` trigger, so a
 * future destructive data migration or hand-edit stays reconstructible.
 *
 * These are behavioral assertions against real Postgres: writes go through a
 * role-impersonated `authenticated` session (so RLS and `auth.uid()` evaluate
 * exactly as in production) inside a transaction that is always rolled back.
 *
 * Run locally:   DATABASE_URL=... bun run test:integration
 * Run in CI:     see .github/workflows/db-lint.yml — integration tests step.
 */

import { describe, expect, it, afterAll } from "vitest";
import type { PoolClient } from "pg";
import {
  SEEDED_UUIDS,
  teardownPool,
  withRoleClient,
} from "./_helpers/role-client";

/** Deterministic fixture ids; nothing else in the suite uses the 0282 block. */
const SUPPLIER_ID = "00000000-0000-0000-0282-000000000001";
const CATALOG_ITEM_ID = "00000000-0000-0000-0282-000000000002";

type RevisionRow = {
  operation: string;
  revision_number: number;
  entity_id: string;
  changed_by: string | null;
  old_preferred: boolean | null;
  new_preferred: boolean | null;
  old_supplier_id: string | null;
};

/**
 * Insert a supplier + one catalog row, returning the catalog row id. Runs as
 * the caller's session so RLS applies (admin holds purchasing:write).
 */
async function seedCatalogRow(db: PoolClient): Promise<string> {
  await db.query(
    "INSERT INTO suppliers (id, name) VALUES ($1, 'Revision Trail Test Supplier')",
    [SUPPLIER_ID],
  );
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO supplier_catalog
       (supplier_id, catalog_type, catalog_id, price, unit, is_preferred)
     VALUES ($1, 'hop', $2, 12.5, 'lb', false)
     RETURNING id`,
    [SUPPLIER_ID, CATALOG_ITEM_ID],
  );
  return rows[0].id;
}

/** Every revision row the trigger wrote for one catalog row, oldest first. */
async function revisionsFor(
  db: PoolClient,
  catalogRowId: string,
): Promise<RevisionRow[]> {
  const { rows } = await db.query<RevisionRow>(
    `SELECT operation,
            revision_number,
            entity_id,
            changed_by,
            (old_data->>'is_preferred')::boolean AS old_preferred,
            (new_data->>'is_preferred')::boolean AS new_preferred,
            old_data->>'supplier_id' AS old_supplier_id
       FROM entity_revisions
      WHERE entity_type = 'supplier_catalog' AND entity_id = $1
      ORDER BY revision_number`,
    [catalogRowId],
  );
  return rows;
}

afterAll(async () => {
  await teardownPool();
});

describe("supplier_catalog writes an entity_revisions row (#549, 00282)", () => {
  it("records INSERT, UPDATE and DELETE with the acting user", async () => {
    await withRoleClient("admin", async (db) => {
      const catalogRowId = await seedCatalogRow(db);

      await db.query(
        "UPDATE supplier_catalog SET is_preferred = true WHERE id = $1",
        [catalogRowId],
      );
      await db.query("DELETE FROM supplier_catalog WHERE id = $1", [
        catalogRowId,
      ]);

      const revisions = await revisionsFor(db, catalogRowId);
      expect(revisions.map((r) => r.operation)).toEqual([
        "INSERT",
        "UPDATE",
        "DELETE",
      ]);
      expect(revisions.map((r) => r.revision_number)).toEqual([1, 2, 3]);
      // entity_id is COALESCE(NEW.id, OLD.id) — the DELETE row must still
      // point at the catalog row, which is what makes it findable later.
      expect(new Set(revisions.map((r) => r.entity_id))).toEqual(
        new Set([catalogRowId]),
      );
      // changed_by = auth.uid(): the ledger names who made each change.
      expect(revisions.map((r) => r.changed_by)).toEqual([
        SEEDED_UUIDS.admin,
        SEEDED_UUIDS.admin,
        SEEDED_UUIDS.admin,
      ]);
    });
  });

  it("preserves the preferred flag of a deleted row (the #549 loss mode)", async () => {
    await withRoleClient("admin", async (db) => {
      const catalogRowId = await seedCatalogRow(db);
      await db.query(
        "UPDATE supplier_catalog SET is_preferred = true WHERE id = $1",
        [catalogRowId],
      );

      // Exactly the shape of 00252's collision cleanup: a set-based DELETE
      // that removes the row without reading is_preferred. FOR EACH ROW means
      // the trigger still fires once per deleted row.
      await db.query(
        `DELETE FROM supplier_catalog sc
          USING suppliers s
          WHERE s.id = sc.supplier_id AND s.id = $1`,
        [SUPPLIER_ID],
      );
      const { rows: remaining } = await db.query(
        "SELECT id FROM supplier_catalog WHERE id = $1",
        [catalogRowId],
      );
      expect(remaining).toHaveLength(0);

      // The flag, and the supplier it belonged to, survive in the ledger —
      // so the same loss is now repairable without a PITR clone.
      const deleteRevision = (await revisionsFor(db, catalogRowId)).at(-1);
      expect(deleteRevision?.operation).toBe("DELETE");
      expect(deleteRevision?.old_preferred).toBe(true);
      expect(deleteRevision?.old_supplier_id).toBe(SUPPLIER_ID);
      expect(deleteRevision?.new_preferred).toBeNull();
    });
  });
});
