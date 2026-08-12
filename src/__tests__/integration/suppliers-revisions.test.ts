/**
 * `suppliers` deletion trail — migration 00286 (#694).
 *
 * 00252_merge_duplicate_suppliers.sql:86 hard-DELETEd supplier rows at the
 * top level of a migration — the same incident class as #549 — and nothing
 * recorded them. 00282 deliberately excluded `suppliers` from the full
 * revision trigger because the MongoDB sync upserts every supplier document
 * on every run, so an INSERT/UPDATE trigger would be one no-change ledger row
 * per supplier per sync. 00286 attaches a DELETE-only trigger instead:
 * deletion is the loss mode, and a DELETE-only trigger never fires on sync
 * churn.
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

/** Deterministic fixture id; nothing else in the suite uses the 0694 block. */
const SUPPLIER_ID = "00000000-0000-0000-0694-000000000001";

type RevisionRow = {
  operation: string;
  revision_number: number;
  entity_id: string;
  changed_by: string | null;
  old_name: string | null;
  new_data_is_null: boolean;
};

/** Every revision row the trigger wrote for one supplier, oldest first. */
async function revisionsFor(
  db: PoolClient,
  supplierId: string,
): Promise<RevisionRow[]> {
  const { rows } = await db.query<RevisionRow>(
    `SELECT operation,
            revision_number,
            entity_id,
            changed_by,
            old_data->>'name' AS old_name,
            (new_data IS NULL) AS new_data_is_null
       FROM entity_revisions
      WHERE entity_type = 'suppliers' AND entity_id = $1
      ORDER BY revision_number`,
    [supplierId],
  );
  return rows;
}

afterAll(async () => {
  await teardownPool();
});

describe("suppliers deletions write an entity_revisions row (#694, 00286)", () => {
  it("records only DELETE — INSERT and UPDATE stay silent (sync-churn guard)", async () => {
    await withRoleClient("admin", async (db) => {
      // INSERT + UPDATE are the MongoDB sync's write shape (upsert every
      // supplier, every run). The trigger is AFTER DELETE only, so neither
      // may produce a ledger row.
      await db.query(
        "INSERT INTO suppliers (id, name) VALUES ($1, 'Deletion Trail Test Supplier')",
        [SUPPLIER_ID],
      );
      await db.query(
        "UPDATE suppliers SET notes = 'updated by sync' WHERE id = $1",
        [SUPPLIER_ID],
      );
      expect(await revisionsFor(db, SUPPLIER_ID)).toHaveLength(0);

      await db.query("DELETE FROM suppliers WHERE id = $1", [SUPPLIER_ID]);

      const revisions = await revisionsFor(db, SUPPLIER_ID);
      expect(revisions).toHaveLength(1);
      const deletion = revisions[0];
      expect(deletion.operation).toBe("DELETE");
      expect(deletion.revision_number).toBe(1);
      // entity_id is COALESCE(NEW.id, OLD.id) — the DELETE row must still
      // point at the supplier, which is what makes it findable later.
      expect(deletion.entity_id).toBe(SUPPLIER_ID);
      // The full row image survives in old_data; new_data is NULL for DELETE.
      expect(deletion.old_name).toBe("Deletion Trail Test Supplier");
      expect(deletion.new_data_is_null).toBe(true);
      // changed_by = auth.uid(): the ledger names who made the deletion.
      expect(deletion.changed_by).toBe(SEEDED_UUIDS.admin);
    });
  });

  it("preserves deleted rows from a set-based DELETE (the 00252:86 loss mode)", async () => {
    await withRoleClient("admin", async (db) => {
      await db.query(
        `INSERT INTO suppliers (id, name, payment_terms)
         VALUES ($1, 'Merge Loser Supplier', 'Net 30')`,
        [SUPPLIER_ID],
      );

      // Exactly the shape of 00252's supplier cleanup: a set-based DELETE
      // that removes the row without reading it. FOR EACH ROW means the
      // trigger still fires once per deleted row.
      await db.query("DELETE FROM suppliers WHERE name = 'Merge Loser Supplier'");
      const { rows: remaining } = await db.query(
        "SELECT id FROM suppliers WHERE id = $1",
        [SUPPLIER_ID],
      );
      expect(remaining).toHaveLength(0);

      const deletion = (await revisionsFor(db, SUPPLIER_ID)).at(-1);
      expect(deletion?.operation).toBe("DELETE");
      expect(deletion?.old_name).toBe("Merge Loser Supplier");
    });
  });
});
