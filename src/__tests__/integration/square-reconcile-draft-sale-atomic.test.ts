/**
 * Real-Postgres regressions for reconcile_square_draft_sale_atomic (00293, #834).
 *
 * Route mocks prove which RPC is called; only Postgres can prove the
 * transaction boundary: a duplicate key never double-allocates, a voided sale
 * writes nothing, and a guard rejection rolls back BOTH the allocation rows
 * and the reconciled_at stamp together.
 */

import { afterAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });

afterAll(async () => {
  await pool.end();
});

async function withTransaction<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    return await fn(db);
  } finally {
    await db.query("ROLLBACK").catch(() => undefined);
    db.release();
  }
}

type Fixture = { saleId: string; finishedGoodId: string };

/** Brand + keg lot (2 kegs of 0.5 bbl) + one unreconciled 1-bbl draft sale. */
async function createFixture(db: PoolClient, suffix: string, opts?: { voided?: boolean }): Promise<Fixture> {
  const { rows: locations } = await db.query<{ id: string }>(
    "INSERT INTO locations (name) VALUES ($1) RETURNING id",
    [`Reconcile loc ${suffix}`],
  );
  const { rows: brands } = await db.query<{ id: string }>(
    "INSERT INTO brands (name) VALUES ($1) RETURNING id",
    [`Reconcile brand ${suffix}`],
  );
  const { rows: containers } = await db.query<{ id: string }>(
    `INSERT INTO containers (name, type, volume_oz, volume_bbl)
     VALUES ($1, 'keg', NULL, 0.5) RETURNING id`,
    [`Reconcile keg ${suffix}`],
  );
  const { rows: formats } = await db.query<{ id: string }>(
    `INSERT INTO selling_formats (container_id, name, unit_count)
     VALUES ($1, $2, 1) RETURNING id`,
    [containers[0]!.id, `Reconcile pour ${suffix}`],
  );
  const { rows: goods } = await db.query<{ id: string }>(
    `INSERT INTO finished_goods (brand_id, selling_format_id, quantity, lot_number, production_date)
     VALUES ($1, $2, 2, $3, CURRENT_DATE - 7) RETURNING id`,
    [brands[0]!.id, formats[0]!.id, `LOT-${suffix}`],
  );
  const { rows: sales } = await db.query<{ id: string }>(
    `INSERT INTO square_draft_sales (
       square_order_id, brand_id, quantity, volume_oz, location_id, sold_at,
       selling_format_id, voided_at
     ) VALUES ($1, $2, 4, 3968, $3, now() - interval '1 day', $4, $5)
     RETURNING id`,
    [
      `order-${suffix}`,
      brands[0]!.id,
      locations[0]!.id,
      formats[0]!.id,
      opts?.voided ? new Date() : null,
    ],
  );
  return { saleId: sales[0]!.id, finishedGoodId: goods[0]!.id };
}

const RECONCILE = `SELECT reconcile_square_draft_sale_atomic($1::uuid, $2::jsonb, now()) AS outcome`;

function rowsJson(finishedGoodId: string, kegs: number, bbl: number): string {
  return JSON.stringify([
    {
      source_id: finishedGoodId,
      quantity: kegs,
      volume_bbl: bbl,
      completed_at: "2026-07-01T00:00:00Z",
      notes: "integration test draw",
    },
  ]);
}

describe("reconcile_square_draft_sale_atomic", () => {
  it("inserts the rows, stamps reconciled_at, and dedupes a second call by key", async () => {
    await withTransaction(async (db) => {
      const fx = await createFixture(db, `ins-${Date.now()}`);

      const first = await db.query<{ outcome: string }>(RECONCILE, [
        fx.saleId,
        rowsJson(fx.finishedGoodId, 2, 1.0),
      ]);
      expect(first.rows[0]!.outcome).toBe("inserted");

      const { rows: allocs } = await db.query(
        "SELECT quantity, volume_bbl, status, destination_type FROM allocations WHERE idempotency_key = $1",
        [`square_draft_sale:${fx.saleId}`],
      );
      expect(allocs).toHaveLength(1);
      expect(allocs[0]).toMatchObject({ status: "completed", destination_type: "taproom_sale" });

      const { rows: stamped } = await db.query<{ reconciled_at: Date | null }>(
        "SELECT reconciled_at FROM square_draft_sales WHERE id = $1",
        [fx.saleId],
      );
      expect(stamped[0]!.reconciled_at).toBeInstanceOf(Date);

      // Second call (a concurrent loser, or a re-run): no new rows.
      const second = await db.query<{ outcome: string }>(RECONCILE, [
        fx.saleId,
        rowsJson(fx.finishedGoodId, 2, 1.0),
      ]);
      expect(second.rows[0]!.outcome).toBe("already_keyed");
      const { rows: after } = await db.query(
        "SELECT count(*)::int AS n FROM allocations WHERE idempotency_key = $1",
        [`square_draft_sale:${fx.saleId}`],
      );
      expect(after[0]).toEqual({ n: 1 });
    });
  });

  it("returns 'voided' for a voided sale and writes nothing", async () => {
    await withTransaction(async (db) => {
      const fx = await createFixture(db, `void-${Date.now()}`, { voided: true });

      const res = await db.query<{ outcome: string }>(RECONCILE, [
        fx.saleId,
        rowsJson(fx.finishedGoodId, 2, 1.0),
      ]);
      expect(res.rows[0]!.outcome).toBe("voided");

      const { rows } = await db.query(
        "SELECT count(*)::int AS n FROM allocations WHERE idempotency_key = $1",
        [`square_draft_sale:${fx.saleId}`],
      );
      expect(rows[0]).toEqual({ n: 0 });
    });
  });

  it("a guard_allocation_availability rejection rolls back rows AND stamp together", async () => {
    await withTransaction(async (db) => {
      const fx = await createFixture(db, `guard-${Date.now()}`);

      // The lot holds 2 kegs; drawing 5 trips guard_allocation_availability
      // (00212). Run in a savepoint so the outer fixture transaction survives.
      await db.query("SAVEPOINT reconcile_attempt");
      await expect(
        db.query(RECONCILE, [fx.saleId, rowsJson(fx.finishedGoodId, 5, 2.5)]),
      ).rejects.toThrow(/exceeds|availability/i);
      await db.query("ROLLBACK TO SAVEPOINT reconcile_attempt");

      const { rows: allocs } = await db.query(
        "SELECT count(*)::int AS n FROM allocations WHERE idempotency_key = $1",
        [`square_draft_sale:${fx.saleId}`],
      );
      expect(allocs[0]).toEqual({ n: 0 });
      const { rows: stamped } = await db.query<{ reconciled_at: Date | null }>(
        "SELECT reconciled_at FROM square_draft_sales WHERE id = $1",
        [fx.saleId],
      );
      expect(stamped[0]!.reconciled_at).toBeNull();
    });
  });
});
