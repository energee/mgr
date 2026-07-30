/**
 * `enum_values` revision trail — migration 00282 (#549 sibling sweep).
 *
 * `enum_values` is the second table 00282 puts under the `entity_revisions`
 * ledger, and it is there because the sibling sweep found the #549 loss mode
 * had already happened on it four times: 00038:10, 00039:15, 00039:29 and
 * 00050:6 are top-level one-shot `DELETE FROM enum_values WHERE enum_type =
 * '...'` statements followed by a reseed. `enum_values` is a registered,
 * user-editable entity (`src/entities/enum-value/core.ts`, surfaced at
 * /settings/status-options) carrying admin-set label, description, color,
 * icon, sort_order, group_name and `is_default`, so a delete-and-reseed
 * discards human decisions that nothing else in the system holds.
 *
 * These are behavioral assertions against real Postgres: writes go through a
 * role-impersonated `authenticated` session (so RLS and `auth.uid()` evaluate
 * exactly as in production) inside a transaction that is always rolled back.
 *
 * Read authorization for the new entity_type is covered by
 * `entity-revisions-rls.test.ts` (settings:manage, admin-only).
 *
 * Run locally:   DATABASE_URL=... bun run test:integration
 * Run in CI:     see .github/workflows/db-lint.yml — integration tests step.
 */

import { afterAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import {
  SEEDED_UUIDS,
  teardownPool,
  withRoleClient,
} from "./_helpers/role-client";

/** An enum_type no migration or seed uses, so the fixture is self-contained. */
const FIXTURE_ENUM_TYPE = "issue_549_probe_status";

type RevisionRow = {
  operation: string;
  revision_number: number;
  entity_id: string;
  changed_by: string | null;
  old_label: string | null;
  old_color: string | null;
  old_sort_order: string | null;
  old_is_default: boolean | null;
};

/**
 * Seed one enum value carrying the kind of admin customization a reseed
 * destroys: a hand-written label, a chosen color, a sort position, and the
 * is_default flag. Runs as the caller's session so RLS applies (admin holds
 * settings:manage, which `enum_values_write` requires).
 */
async function seedEnumValue(db: PoolClient): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO enum_values
       (enum_type, value, label, description, color, sort_order, is_default)
     VALUES ($1, 'probe', 'Operator Renamed This', 'fixture', 'warning', 42, true)
     RETURNING id`,
    [FIXTURE_ENUM_TYPE],
  );
  return rows[0].id;
}

/** Every revision row the trigger wrote for one enum value, oldest first. */
async function revisionsFor(
  db: PoolClient,
  enumValueId: string,
): Promise<RevisionRow[]> {
  const { rows } = await db.query<RevisionRow>(
    `SELECT operation,
            revision_number,
            entity_id,
            changed_by,
            old_data->>'label'       AS old_label,
            old_data->>'color'       AS old_color,
            old_data->>'sort_order'  AS old_sort_order,
            (old_data->>'is_default')::boolean AS old_is_default
       FROM entity_revisions
      WHERE entity_type = 'enum_values' AND entity_id = $1
      ORDER BY revision_number`,
    [enumValueId],
  );
  return rows;
}

afterAll(async () => {
  await teardownPool();
});

describe("enum_values writes an entity_revisions row (#549 sweep, 00282)", () => {
  it("records INSERT, UPDATE and DELETE with the acting user", async () => {
    await withRoleClient("admin", async (db) => {
      const enumValueId = await seedEnumValue(db);

      await db.query("UPDATE enum_values SET color = 'success' WHERE id = $1", [
        enumValueId,
      ]);
      await db.query("DELETE FROM enum_values WHERE id = $1", [enumValueId]);

      const revisions = await revisionsFor(db, enumValueId);
      expect(revisions.map((r) => r.operation)).toEqual([
        "INSERT",
        "UPDATE",
        "DELETE",
      ]);
      expect(revisions.map((r) => r.revision_number)).toEqual([1, 2, 3]);
      expect(new Set(revisions.map((r) => r.entity_id))).toEqual(
        new Set([enumValueId]),
      );
      expect(revisions.map((r) => r.changed_by)).toEqual([
        SEEDED_UUIDS.admin,
        SEEDED_UUIDS.admin,
        SEEDED_UUIDS.admin,
      ]);
    });
  });

  it("preserves an admin's customizations through a wholesale reseed", async () => {
    await withRoleClient("admin", async (db) => {
      const enumValueId = await seedEnumValue(db);

      // Exactly the shape of 00038/00039/00050: delete every row of one
      // enum_type, then insert the replacement set. FOR EACH ROW means the
      // trigger still fires once per deleted row.
      await db.query("DELETE FROM enum_values WHERE enum_type = $1", [
        FIXTURE_ENUM_TYPE,
      ]);
      await db.query(
        `INSERT INTO enum_values (enum_type, value, label, sort_order, is_default)
         VALUES ($1, 'probe', 'Probe', 0, false)`,
        [FIXTURE_ENUM_TYPE],
      );

      const deleteRevision = (await revisionsFor(db, enumValueId)).at(-1);
      expect(deleteRevision?.operation).toBe("DELETE");
      // The four fields a reseed silently overwrites are all recoverable.
      expect(deleteRevision?.old_label).toBe("Operator Renamed This");
      expect(deleteRevision?.old_color).toBe("warning");
      expect(deleteRevision?.old_sort_order).toBe("42");
      expect(deleteRevision?.old_is_default).toBe(true);
    });
  });
});
