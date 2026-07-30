/**
 * Concurrency coverage for the server-side availability guards (issue #437,
 * criterion 6; left open by #557).
 *
 * `inventory-guards.test.ts` pins both guards on a single connection. Their
 * migrations, however, make an explicitly *concurrent* claim, and that is the
 * one that matters — the guards exist because two users could oversell the
 * same lot:
 *
 *  - 00212 `guard_allocation_availability`: "locks the source row
 *    (SELECT ... FOR UPDATE — serializes concurrent allocators)".
 *  - 00216 `guard_finished_good_outbound`: "the UPDATE already holds the
 *    finished_goods row lock, and 00212's allocator locks the same row before
 *    inserting an allocation, so the two guards serialize on that row".
 *
 * Both tests run two real transactions on two connections: the second one is
 * driven until Postgres reports it *blocked on a lock*, the first is then
 * committed, and the second is required to reject on the now-visible committed
 * state instead of writing on top of a stale read.
 *
 * ## Why these tests commit (and how they clean up)
 *
 * Every other suite here is BEGIN/ROLLBACK. A cross-transaction race cannot be:
 * transaction B can only observe A's write once A commits. So these two tests
 * commit, and `cleanup()` in a `finally` removes every row they wrote — the
 * allocations are demoted out of `completed` first, because 00211's
 * trg_prevent_completed_allocation_delete refuses to hard-delete a completed
 * depletion.
 *
 * Determinism: nothing here sleeps for a fixed period. `waitUntilBlocked` polls
 * pg_stat_activity until the contending backend is actually waiting on a lock,
 * so the interleaving is observed rather than assumed, and every statement runs
 * under a lock_timeout/statement_timeout so a regression that stops blocking
 * fails the test instead of hanging CI.
 *
 * Run locally:   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
 *                bun run test:integration
 */

import { afterAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

import { requireDatabaseUrl } from "./_helpers/role-client";

const pool = new Pool({ connectionString: requireDatabaseUrl(), max: 6 });

/** Deterministic UUID namespace for this suite: issue 0437, sub-range 0006. */
function uid(n: number): string {
  return `00000000-0000-0000-0437-0006${String(n).padStart(8, "0")}`;
}

afterAll(async () => {
  await pool.end();
});

/**
 * Every id this suite may create: 100-109 for the allocation-availability
 * race, 200-209 for the finished-goods outbound race. Keep this in step with
 * the `uid(...)` calls below — a committed row missed here survives the run.
 */
const ALL_IDS = [
  ...Array.from({ length: 10 }, (_, i) => uid(100 + i)),
  ...Array.from({ length: 10 }, (_, i) => uid(200 + i)),
];

/**
 * Removes everything the committing tests wrote. Safe to call when nothing was
 * written. Completed allocations are demoted to 'cancelled' first: 00211 blocks
 * hard-deleting a completed depletion, deliberately.
 */
async function cleanup(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE allocations SET status = 'cancelled' WHERE id = ANY($1::uuid[])`,
      [ALL_IDS]
    );
    await client.query(`DELETE FROM allocations WHERE id = ANY($1::uuid[])`, [ALL_IDS]);
    await client.query(`DELETE FROM finished_goods WHERE id = ANY($1::uuid[])`, [ALL_IDS]);
    await client.query(`DELETE FROM selling_formats WHERE id = ANY($1::uuid[])`, [ALL_IDS]);
    await client.query(`DELETE FROM containers WHERE id = ANY($1::uuid[])`, [ALL_IDS]);
    await client.query(`DELETE FROM brands WHERE id = ANY($1::uuid[])`, [ALL_IDS]);
    await client.query(`DELETE FROM inventory_lots WHERE id = ANY($1::uuid[])`, [ALL_IDS]);
    await client.query(`DELETE FROM inventory_items WHERE id = ANY($1::uuid[])`, [ALL_IDS]);
    // 00211 logs every allocation write to entity_revisions.
    await client.query(`DELETE FROM entity_revisions WHERE entity_id = ANY($1::uuid[])`, [
      ALL_IDS,
    ]);
  } finally {
    client.release();
  }
}

/**
 * Opens a transaction with bounded lock waits, so a guard that stops blocking
 * surfaces as a failed test rather than a hung CI job.
 */
async function beginBounded(client: PoolClient): Promise<void> {
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout = '10s'");
  await client.query("SET LOCAL statement_timeout = '15s'");
}

async function backendPid(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ pid: number }>(`SELECT pg_backend_pid() AS pid`);
  return rows[0].pid;
}

/** Resolves once `pid` is waiting on a lock. Rejects if it never blocks. */
async function waitUntilBlocked(observer: PoolClient, pid: number): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const { rows } = await observer.query<{ wait_event_type: string | null }>(
      `SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`,
      [pid]
    );
    if (rows[0]?.wait_event_type === "Lock") return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `backend ${pid} never blocked on a lock — the guard did not serialize concurrent writers`
  );
}

describe("guard_allocation_availability under concurrency (00212)", () => {
  it("rejects the second of two allocations that only oversell together", async () => {
    const a = await pool.connect();
    const b = await pool.connect();
    const observer = await pool.connect();
    try {
      // 100 lb on hand, committed so both transactions can see it.
      await a.query(
        `INSERT INTO inventory_items (id, category, name, unit)
         VALUES ($1, 'grain', 'Concurrency guard grain', 'lb')`,
        [uid(100)]
      );
      await a.query(
        `INSERT INTO inventory_lots (id, inventory_item_id, quantity, unit)
         VALUES ($1, $2, 100, 'lb')`,
        [uid(101), uid(100)]
      );

      await beginBounded(a);
      await beginBounded(b);

      // A takes 60 of the 100 — fine on its own.
      await a.query(
        `INSERT INTO allocations
           (id, source_type, source_id, destination_type, destination_id, quantity, status)
         VALUES ($1, 'inventory_lot', $2, 'batch', $3, 60, 'planned')`,
        [uid(102), uid(101), uid(103)]
      );

      // B takes 50 — also fine against the state B can currently see (0
      // allocated), but 110 together. B must block on A's row lock, not read
      // stale availability and write.
      const bPid = await backendPid(b);
      const bInsert = b.query(
        `INSERT INTO allocations
           (id, source_type, source_id, destination_type, destination_id, quantity, status)
         VALUES ($1, 'inventory_lot', $2, 'batch', $3, 50, 'planned')`,
        [uid(104), uid(101), uid(105)]
      );
      const settled: { rejected?: unknown } = {};
      const bSettled = bInsert.catch((err: unknown) => {
        settled.rejected = err;
      });

      await waitUntilBlocked(observer, bPid);
      await a.query("COMMIT");
      await bSettled;

      expect(settled.rejected).toBeInstanceOf(Error);
      expect(String(settled.rejected)).toMatch(/exceeds availability/);
      await b.query("ROLLBACK");

      // Availability never went negative: only A's 60 landed.
      const { rows } = await observer.query<{ allocated: string }>(
        `SELECT COALESCE(SUM(quantity), 0) AS allocated FROM allocations
         WHERE source_type = 'inventory_lot' AND source_id = $1
           AND status IN ('planned', 'completed')`,
        [uid(101)]
      );
      expect(Number(rows[0].allocated)).toBe(60);
    } finally {
      for (const client of [a, b]) {
        await client.query("ROLLBACK").catch(() => {});
        client.release();
      }
      observer.release();
      await cleanup();
    }
  });
});

describe("guard_finished_good_outbound under concurrency (00216)", () => {
  it("rejects a stock reduction racing an allocation of the same lot", async () => {
    const a = await pool.connect();
    const b = await pool.connect();
    const observer = await pool.connect();
    try {
      await a.query(`INSERT INTO brands (id, name) VALUES ($1, 'Concurrency guard brand')`, [
        uid(200),
      ]);
      await a.query(
        `INSERT INTO containers (id, name, type, volume_oz)
         VALUES ($1, 'Concurrency guard package', 'package', 1984)`,
        [uid(201)]
      );
      await a.query(
        `INSERT INTO selling_formats (id, container_id, name, unit_count)
         VALUES ($1, $2, 'Concurrency guard unit', 1)`,
        [uid(202), uid(201)]
      );
      await a.query(
        `INSERT INTO finished_goods
           (id, brand_id, selling_format_id, quantity, lot_number)
         VALUES ($1, $2, $3, 100, 'CONCUR-200')`,
        [uid(203), uid(200), uid(202)]
      );

      await beginBounded(a);
      await beginBounded(b);

      // A reserves 80 units. 00212's guard locks the finished_goods row.
      await a.query(
        `INSERT INTO allocations
           (id, source_type, source_id, destination_type, destination_id, quantity, status)
         VALUES ($1, 'finished_good', $2, 'order', $3, 80, 'planned')`,
        [uid(204), uid(203), uid(205)]
      );

      // B writes the lot down to 50 — legal against the state B can see (0
      // allocated), but it would strand A's 80 units.
      const bPid = await backendPid(b);
      const bUpdate = b.query(`UPDATE finished_goods SET quantity = 50 WHERE id = $1`, [
        uid(203),
      ]);
      const settled: { rejected?: unknown } = {};
      const bSettled = bUpdate.catch((err: unknown) => {
        settled.rejected = err;
      });

      await waitUntilBlocked(observer, bPid);
      await a.query("COMMIT");
      await bSettled;

      expect(settled.rejected).toBeInstanceOf(Error);
      expect(String(settled.rejected)).toMatch(/already allocated/);
      await b.query("ROLLBACK");

      const { rows } = await observer.query<{ quantity: number }>(
        `SELECT quantity FROM finished_goods WHERE id = $1`,
        [uid(203)]
      );
      expect(rows).toEqual([{ quantity: 100 }]);
    } finally {
      for (const client of [a, b]) {
        await client.query("ROLLBACK").catch(() => {});
        client.release();
      }
      observer.release();
      await cleanup();
    }
  });
});
