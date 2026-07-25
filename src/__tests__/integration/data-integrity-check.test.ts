/**
 * check_data_integrity() integration coverage (migrations 00272 + 00273).
 *
 * 00272 shipped the nightly watchdog with a check that read
 * `allocations.inventory_item_id` — a column gone since 00010. PL/pgSQL plans
 * statements on first EXECUTION, not at CREATE FUNCTION time, so the migration
 * applied cleanly and the 05:30 UTC cron job then aborted every run. Nothing in
 * the suite executed the function, so nothing noticed.
 *
 * The first test here is the check that would have caught it: call the function
 * and assert it does not raise. The rest pin what each invariant detects.
 *
 * All tests run inside BEGIN/ROLLBACK; nothing is committed.
 */

import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/** Deterministic UUID namespace for this suite: migration 0273. */
function uid(n: number): string {
  return `00000000-0000-0000-0273-${String(n).padStart(12, "0")}`;
}

afterAll(async () => {
  await pool.end();
});

/** Runs `fn` in a transaction that is always rolled back. */
async function inRollback<T>(fn: (c: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    return await fn(client);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

/** Seeds an inventory item + lot of `quantity` units. */
async function seedLot(
  client: import("pg").PoolClient,
  base: number,
  quantity: number
): Promise<string> {
  const itemId = uid(base + 1);
  const lotId = uid(base + 2);
  await client.query(
    `INSERT INTO inventory_items (id, category, name, unit)
     VALUES ($1, 'grain', $2, 'lb')`,
    [itemId, `Integrity test item ${base}`]
  );
  await client.query(
    `INSERT INTO inventory_lots (id, inventory_item_id, quantity, unit)
     VALUES ($1, $2, $3, 'lb')`,
    [lotId, itemId, quantity]
  );
  return lotId;
}

/**
 * Allocates `quantity` against `lotId` with 00212's availability guard
 * disabled — the only way to stage the corruption the check looks for, and
 * exactly what a finding means in production (the guard was bypassed).
 */
async function overAllocate(
  client: import("pg").PoolClient,
  base: number,
  lotId: string,
  quantity: number
) {
  await client.query(
    "ALTER TABLE allocations DISABLE TRIGGER trg_guard_allocation_availability"
  );
  await client.query(
    `INSERT INTO allocations
       (id, source_type, source_id, destination_type, destination_id, quantity, status)
     VALUES ($1, 'inventory_lot', $2, 'batch', NULL, $3, 'completed')`,
    [uid(base + 3), lotId, quantity]
  );
  await client.query(
    "ALTER TABLE allocations ENABLE TRIGGER trg_guard_allocation_availability"
  );
}

async function findings(client: import("pg").PoolClient, checkName: string) {
  const { rows } = await client.query(
    `SELECT entity_table, entity_id, detail, resolved_at
     FROM data_integrity_findings
     WHERE check_name = $1`,
    [checkName]
  );
  return rows;
}

describe("check_data_integrity()", () => {
  it("executes without raising (regression: 00272 read a dropped column)", async () => {
    await inRollback(async (client) => {
      // The whole body is one statement sequence in one transaction, so a bad
      // plan anywhere aborts every check. This assertion is the guard.
      await expect(client.query("SELECT check_data_integrity()")).resolves.toBeTruthy();
    });
  });

  it("records an over-allocated lot", async () => {
    await inRollback(async (client) => {
      const lotId = await seedLot(client, 100, 100);
      await overAllocate(client, 100, lotId, 150);

      await client.query("SELECT check_data_integrity()");

      const rows = await findings(client, "over_allocated_lot");
      expect(rows).toHaveLength(1);
      expect(rows[0].entity_id).toBe(lotId);
      expect(rows[0].entity_table).toBe("inventory_lots");
      expect(rows[0].detail).toContain("-50");
      expect(rows[0].resolved_at).toBeNull();
    });
  });

  it("leaves a fully-but-not-over allocated lot alone", async () => {
    await inRollback(async (client) => {
      const lotId = await seedLot(client, 200, 100);
      await overAllocate(client, 200, lotId, 100); // exactly consumed

      await client.query("SELECT check_data_integrity()");

      const rows = await findings(client, "over_allocated_lot");
      expect(rows.filter((r) => r.entity_id === lotId)).toEqual([]);
    });
  });

  it("records a negative lot quantity", async () => {
    await inRollback(async (client) => {
      const lotId = await seedLot(client, 300, -5);

      await client.query("SELECT check_data_integrity()");

      const rows = await findings(client, "negative_lot_quantity");
      expect(rows.map((r) => r.entity_id)).toContain(lotId);
    });
  });

  it("re-detection updates the existing finding instead of duplicating it", async () => {
    await inRollback(async (client) => {
      const lotId = await seedLot(client, 400, 100);
      await overAllocate(client, 400, lotId, 150);

      await client.query("SELECT check_data_integrity()");
      await client.query("SELECT check_data_integrity()");

      // ON CONFLICT (check_name, entity_table, entity_id) DO UPDATE.
      const rows = await findings(client, "over_allocated_lot");
      expect(rows.filter((r) => r.entity_id === lotId)).toHaveLength(1);
    });
  });
});
