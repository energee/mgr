/**
 * Data-integrity watchdog integration coverage
 * (migrations 00272 + 00273 for the sweep, 00281 for the notifier).
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
 * The second suite covers notify_data_integrity_findings() (00281, issue #586):
 * findings used to reach nobody at all, and the risk in fixing that is the
 * opposite failure — a duplicate alert every night until people mute it. Those
 * tests pin "announced exactly once per occurrence".
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

// =============================================================================
// notify_data_integrity_findings() — migration 00281 (issue #586)
// =============================================================================

/**
 * Empties the findings table and any previously-recorded data-integrity
 * notifications so a run's counts are deterministic. Safe: every test here is
 * inside a rolled-back transaction, so nothing is really deleted — but a dev
 * database can carry real open findings from earlier sweeps (which would be
 * announced alongside the staged ones) and real `data_integrity` notifications
 * (which would break the summary-alert assertions below).
 */
async function clearFindings(client: import("pg").PoolClient) {
  await client.query("DELETE FROM data_integrity_findings");
  await client.query("DELETE FROM notifications WHERE type = 'data_integrity'");
}

/** Stages one open, never-announced finding and returns its id. */
async function openFinding(
  client: import("pg").PoolClient,
  n: number,
  checkName = "negative_lot_quantity"
): Promise<string> {
  const { rows } = await client.query(
    `INSERT INTO data_integrity_findings (check_name, entity_table, entity_id, detail)
     VALUES ($1, 'inventory_lots', $2, 'staged finding for notification coverage')
     RETURNING id`,
    [checkName, uid(500 + n)]
  );
  return rows[0].id as string;
}

/** Recipients notify_all_users() fans out to (00201: active, non-customer). */
async function staffCount(client: import("pg").PoolClient): Promise<number> {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM user_profiles
     WHERE status = 'active' AND NOT ('customer' = ANY(roles))`
  );
  return rows[0].n as number;
}

/** Notifications raised for one finding (one per staff recipient). */
async function alertsFor(client: import("pg").PoolClient, findingId: string) {
  const { rows } = await client.query(
    `SELECT user_id, type, priority, title, message
     FROM notifications
     WHERE entity_type = 'data_integrity_finding' AND entity_id = $1`,
    [findingId]
  );
  return rows;
}

async function notify(client: import("pg").PoolClient): Promise<number> {
  const { rows } = await client.query(
    "SELECT notify_data_integrity_findings() AS announced"
  );
  return rows[0].announced as number;
}

describe("notify_data_integrity_findings()", () => {
  it("announces an open finding to every active staff user", async () => {
    await inRollback(async (client) => {
      await clearFindings(client);
      const findingId = await openFinding(client, 1);
      const staff = await staffCount(client);
      expect(staff).toBeGreaterThan(0); // role fixtures must be seeded

      expect(await notify(client)).toBe(1);

      const alerts = await alertsFor(client, findingId);
      // One per recipient, minus anyone who turned in-app notifications off
      // (create_notification honours notification_preferences).
      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts.length).toBeLessThanOrEqual(staff);
      expect(alerts[0].type).toBe("data_integrity");
      expect(alerts[0].priority).toBe("high");
      expect(alerts[0].message).toContain("Negative inventory lot quantity");
    });
  });

  it("does not announce the same open finding twice (issue #586: no daily duplicate)", async () => {
    await inRollback(async (client) => {
      await clearFindings(client);
      const findingId = await openFinding(client, 2);

      expect(await notify(client)).toBe(1);
      const first = await alertsFor(client, findingId);

      expect(await notify(client)).toBe(0);
      expect(await alertsFor(client, findingId)).toHaveLength(first.length);
    });
  });

  it("never announces a finding that is already resolved", async () => {
    await inRollback(async (client) => {
      await clearFindings(client);
      const findingId = await openFinding(client, 3);
      await client.query(
        "UPDATE data_integrity_findings SET resolved_at = NOW() WHERE id = $1",
        [findingId]
      );

      // Nobody should be paged about a violation that already cleared.
      expect(await notify(client)).toBe(0);
      expect(await alertsFor(client, findingId)).toEqual([]);
    });
  });

  it("keeps the announced stamp when the nightly sweep re-detects the finding", async () => {
    await inRollback(async (client) => {
      await clearFindings(client);
      const lotId = await seedLot(client, 600, -5);
      await client.query("SELECT check_data_integrity()");
      expect(await notify(client)).toBeGreaterThan(0);

      // Re-detection upserts the row; notified_at must survive it.
      await client.query("SELECT check_data_integrity()");

      const { rows } = await client.query(
        `SELECT notified_at, resolved_at FROM data_integrity_findings
         WHERE check_name = 'negative_lot_quantity' AND entity_id = $1`,
        [lotId]
      );
      expect(rows[0].notified_at).not.toBeNull();
      expect(rows[0].resolved_at).toBeNull();
      expect(await notify(client)).toBe(0);
    });
  });

  it("announces a finding again once it resolved and then recurred", async () => {
    await inRollback(async (client) => {
      await clearFindings(client);
      const lotId = await seedLot(client, 700, -5);
      await client.query("SELECT check_data_integrity()");
      expect(await notify(client)).toBeGreaterThan(0);

      // Simulate "the violation cleared two days ago" (the sweep only resolves
      // findings whose detected_at is older than a minute).
      await client.query(
        `UPDATE data_integrity_findings
         SET resolved_at = NOW() - INTERVAL '2 days',
             detected_at = NOW() - INTERVAL '2 days'
         WHERE entity_id = $1`,
        [lotId]
      );

      // The violation is still in the data, so this run re-opens the finding.
      await client.query("SELECT check_data_integrity()");

      const { rows } = await client.query(
        `SELECT notified_at, resolved_at FROM data_integrity_findings
         WHERE check_name = 'negative_lot_quantity' AND entity_id = $1`,
        [lotId]
      );
      expect(rows[0].resolved_at).toBeNull();
      expect(rows[0].notified_at).toBeNull(); // recurrence = new event
      expect(await notify(client)).toBeGreaterThan(0);
    });
  });

  it("caps itemised alerts at 20 per run and queues the remainder", async () => {
    await inRollback(async (client) => {
      await clearFindings(client);
      for (let i = 0; i < 21; i++) await openFinding(client, 800 + i);

      expect(await notify(client)).toBe(20);

      // One summary alert (no entity) says how many are still queued.
      const { rows: summary } = await client.query(
        `SELECT DISTINCT metadata FROM notifications
         WHERE type = 'data_integrity' AND entity_type IS NULL`
      );
      expect(summary).toHaveLength(1);
      expect(summary[0].metadata).toMatchObject({ announced: 20, queued: 1 });

      // The 21st keeps notified_at NULL, so the next run announces it.
      expect(await notify(client)).toBe(1);
    });
  });
});
