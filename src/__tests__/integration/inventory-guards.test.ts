/**
 * Server-side inventory guard integration coverage (issue #437).
 *
 * Exercises the two availability guards against real Postgres:
 *  - guard_allocation_availability (00212): BEFORE INSERT/UPDATE on
 *    allocations — rejects a depleting allocation that would exceed the
 *    source's remaining on-hand quantity; exempts count corrections
 *    (destination_type = 'adjustment'); ignores non-active (e.g. cancelled)
 *    allocations when summing what is already committed.
 *  - guard_finished_good_outbound (00216): BEFORE UPDATE on finished_goods —
 *    rejects a quantity reduction below the sum of active allocations sourced
 *    from that finished good; increases and boundary reductions are allowed.
 *
 * Single-connection tests only — concurrency/FOR UPDATE race coverage is
 * deliberately out of scope (flaky in CI; tracked separately in #437).
 *
 * The direct finished_goods seed includes a legacy package_types id because
 * the replayed migration chain still enforces chk_fg_format_xor (00080) —
 * dropped on live but uncaptured; same "Replay-only package" idiom as
 * square-atomic-ingestion.test.ts.
 *
 * All tests run inside BEGIN/ROLLBACK; nothing is committed.
 */

import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Deterministic UUID namespace for this suite: issue 0437, sub-range 0002
 * (packaging-completion-trigger.test.ts uses 0001).
 */
function uid(n: number): string {
  return `00000000-0000-0000-0437-0002${String(n).padStart(8, "0")}`;
}

afterAll(async () => {
  await pool.end();
});

/** Seeds an inventory item + 100-unit lot. `base` offsets the id namespace. */
async function seedLot(client: import("pg").PoolClient, base: number) {
  const itemId = uid(base + 1);
  const lotId = uid(base + 2);
  await client.query(
    `INSERT INTO inventory_items (id, category, name, unit)
     VALUES ($1, 'grain', $2, 'lb')`,
    [itemId, `Guard test item ${base}`]
  );
  await client.query(
    `INSERT INTO inventory_lots (id, inventory_item_id, quantity, unit)
     VALUES ($1, $2, 100, 'lb')`,
    [lotId, itemId]
  );
  return { itemId, lotId };
}

/** Seeds a brand + legacy package type + 100-unit finished-goods lot. */
async function seedFinishedGood(client: import("pg").PoolClient, base: number) {
  const brandId = uid(base + 1);
  const packageTypeId = uid(base + 2);
  const fgId = uid(base + 3);
  await client.query(
    `INSERT INTO brands (id, name) VALUES ($1, $2)`,
    [brandId, `Guard test brand ${base}`]
  );
  await client.query(
    `INSERT INTO package_types (id, name, container_type, volume_oz, units_per_case)
     VALUES ($1, $2, 'can', 16, 4)`,
    [packageTypeId, `Replay-only package ${base}`]
  );
  await client.query(
    `INSERT INTO finished_goods (id, brand_id, package_type_id, quantity, lot_number)
     VALUES ($1, $2, $3, 100, $4)`,
    [fgId, brandId, packageTypeId, `GUARD-${base}`]
  );
  return { brandId, fgId };
}

describe("guard_allocation_availability (00212)", () => {
  it("rejects an allocation exceeding the lot's remaining availability", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { lotId } = await seedLot(client, 100);

      // 60 of the 100 already committed.
      await client.query(
        `INSERT INTO allocations
           (id, source_type, source_id, destination_type, destination_id, quantity, status)
         VALUES ($1, 'inventory_lot', $2, 'batch', $3, 60, 'planned')`,
        [uid(110), lotId, uid(111)]
      );

      await client.query("SAVEPOINT before_oversell");
      await expect(
        client.query(
          `INSERT INTO allocations
             (id, source_type, source_id, destination_type, destination_id, quantity, status)
           VALUES ($1, 'inventory_lot', $2, 'batch', $3, 50, 'planned')`,
          [uid(112), lotId, uid(113)]
        )
      ).rejects.toThrow(/exceeds availability/);
      await client.query("ROLLBACK TO SAVEPOINT before_oversell");

      // The remaining 40 still fits.
      await client.query(
        `INSERT INTO allocations
           (id, source_type, source_id, destination_type, destination_id, quantity, status)
         VALUES ($1, 'inventory_lot', $2, 'batch', $3, 40, 'planned')`,
        [uid(114), lotId, uid(115)]
      );

      const rows = await client.query<{ n: string; total: string }>(
        `SELECT count(*) AS n, COALESCE(sum(quantity), 0) AS total
         FROM allocations
         WHERE source_type = 'inventory_lot' AND source_id = $1`,
        [lotId]
      );
      expect(Number(rows.rows[0].n)).toBe(2);
      expect(Number(rows.rows[0].total)).toBe(100);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("exempts adjustment allocations, which may push availability negative", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { lotId } = await seedLot(client, 200);

      // A count correction larger than on-hand stock is allowed by policy
      // (00212) — it exists precisely to reconcile down to a physical count.
      // chk_allocation_adjustment_reason requires a reason_code; the domain
      // convention is 'count_adjustment' (00211 / src/domain/inventory-count.ts).
      await client.query(
        `INSERT INTO allocations
           (id, source_type, source_id, destination_type, destination_id,
            quantity, status, reason_code)
         VALUES ($1, 'inventory_lot', $2, 'adjustment', NULL, 150, 'completed', 'count_adjustment')`,
        [uid(210), lotId]
      );

      const rows = await client.query<{ quantity: string }>(
        `SELECT quantity FROM allocations WHERE id = $1`,
        [uid(210)]
      );
      expect(Number(rows.rows[0].quantity)).toBe(150);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("ignores cancelled allocations when computing availability", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { lotId } = await seedLot(client, 300);

      // 90 cancelled: does not consume availability (00212 sums only
      // planned/completed).
      await client.query(
        `INSERT INTO allocations
           (id, source_type, source_id, destination_type, destination_id, quantity, status)
         VALUES ($1, 'inventory_lot', $2, 'batch', $3, 90, 'cancelled')`,
        [uid(310), lotId, uid(311)]
      );

      await client.query(
        `INSERT INTO allocations
           (id, source_type, source_id, destination_type, destination_id, quantity, status)
         VALUES ($1, 'inventory_lot', $2, 'batch', $3, 80, 'planned')`,
        [uid(312), lotId, uid(313)]
      );

      const rows = await client.query<{ status: string }>(
        `SELECT status FROM allocations WHERE id = $1`,
        [uid(312)]
      );
      expect(rows.rows).toEqual([{ status: "planned" }]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

describe("guard_finished_good_outbound (00216)", () => {
  it("rejects a quantity reduction below the sum of active allocations", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { fgId } = await seedFinishedGood(client, 400);

      // 40 planned + 30 completed = 70 active outbound.
      await client.query(
        `INSERT INTO allocations
           (id, source_type, source_id, destination_type, destination_id, quantity, status)
         VALUES ($1, 'finished_good', $3, 'order', $4, 40, 'planned'),
                ($2, 'finished_good', $3, 'order', $5, 30, 'completed')`,
        [uid(410), uid(411), fgId, uid(412), uid(413)]
      );

      await client.query("SAVEPOINT before_reduction");
      await expect(
        client.query(`UPDATE finished_goods SET quantity = 60 WHERE id = $1`, [fgId])
      ).rejects.toThrow(/already allocated/);
      await client.query("ROLLBACK TO SAVEPOINT before_reduction");

      const unchanged = await client.query<{ quantity: number }>(
        `SELECT quantity FROM finished_goods WHERE id = $1`,
        [fgId]
      );
      expect(unchanged.rows).toEqual([{ quantity: 100 }]);

      // Reducing exactly TO the committed total is allowed (strict `<` guard).
      await client.query(`UPDATE finished_goods SET quantity = 70 WHERE id = $1`, [fgId]);
      const boundary = await client.query<{ quantity: number }>(
        `SELECT quantity FROM finished_goods WHERE id = $1`,
        [fgId]
      );
      expect(boundary.rows).toEqual([{ quantity: 70 }]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("always allows a quantity increase", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { fgId } = await seedFinishedGood(client, 500);

      await client.query(
        `INSERT INTO allocations
           (id, source_type, source_id, destination_type, destination_id, quantity, status)
         VALUES ($1, 'finished_good', $2, 'order', $3, 100, 'completed')`,
        [uid(510), fgId, uid(511)]
      );

      // Fully committed — but an increase can never strand allocations.
      await client.query(`UPDATE finished_goods SET quantity = 150 WHERE id = $1`, [fgId]);

      const rows = await client.query<{ quantity: number }>(
        `SELECT quantity FROM finished_goods WHERE id = $1`,
        [fgId]
      );
      expect(rows.rows).toEqual([{ quantity: 150 }]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
