/**
 * Packaging-session completion trigger integration coverage (issue #437).
 *
 * Exercises the real Postgres path behind "complete a packaging session":
 * UPDATE packaging_sessions.status -> 'completed' fires
 * on_packaging_session_completion -> create_finished_goods_from_packaging()
 * (introduced 00026, currently the 00232 definition), which creates one
 * finished_goods row per line item (the 00159+ batch_id/selling_format_id
 * shape — the source_batches JSONB the 00145 version iterated was dropped),
 * a completed batch->finished_good allocation, and YYYYMMDD-NNN lot numbers
 * (00142/00205). Also covers the 00159 packaging_session_before_update
 * guards and the 00232 revise_packaging_session below-committed rejection.
 *
 * Replay-chain drift shim: the migration chain still carries the 00080
 * constraints chk_sli_format_xor / chk_fg_format_xor, which require the
 * legacy package_type_id / keg_type_id columns to be populated. The live DB
 * dropped them (uncaptured drift): every UI line-item insert and 00232's own
 * self-verification block write selling_format-only rows, which the replayed
 * chain rejects — verified empirically against a fresh `supabase db reset`.
 * Tests therefore seed line items with a legacy package_types row and add a
 * pg_temp BEFORE INSERT trigger stamping the same legacy id onto the
 * function-created finished_goods rows, satisfying the replayed constraints
 * without altering the schema under test. Same idiom as the "Replay-only
 * package" seed in square-atomic-ingestion.test.ts.
 *
 * All tests run inside BEGIN/ROLLBACK; nothing is committed.
 */

import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Deterministic UUID namespace for this suite: issue 0437, sub-range 0001
 * (inventory-guards.test.ts uses 0002) so concurrently running suites never
 * collide on ids even before their transactions roll back.
 */
function uid(n: number): string {
  return `00000000-0000-0000-0437-0001${String(n).padStart(8, "0")}`;
}

afterAll(async () => {
  await pool.end();
});

type Fixture = {
  brandId: string;
  formatId: string;
  batchAId: string;
  batchBId: string;
  sessionId: string;
  lineAId: string;
  lineBId: string;
};

/**
 * Seeds brand -> container -> selling format -> two packaging-state batches
 * -> one in_progress session with a line item per batch (A: 96, B: 60).
 * `base` offsets the id namespace so each test's fixture is distinct.
 */
async function seedPackagingFixture(
  client: import("pg").PoolClient,
  base: number
): Promise<Fixture> {
  const brandId = uid(base + 1);
  const containerId = uid(base + 2);
  const formatId = uid(base + 3);
  const packageTypeId = uid(base + 4);
  const batchAId = uid(base + 5);
  const batchBId = uid(base + 6);
  const sessionId = uid(base + 7);
  const lineAId = uid(base + 8);
  const lineBId = uid(base + 9);

  await client.query(
    `INSERT INTO brands (id, name) VALUES ($1, $2)`,
    [brandId, `Pkg trigger brand ${base}`]
  );
  await client.query(
    `INSERT INTO containers (id, name, type, volume_oz)
     VALUES ($1, $2, 'package', 16)`,
    [containerId, `Pkg trigger can ${base}`]
  );
  await client.query(
    `INSERT INTO selling_formats (id, container_id, name, unit_count)
     VALUES ($1, $2, $3, 4)`,
    [formatId, containerId, `Pkg trigger 4-pack ${base}`]
  );
  // Legacy package_types row: replay-only xor-constraint shim (see header).
  await client.query(
    `INSERT INTO package_types (id, name, container_type, volume_oz, units_per_case)
     VALUES ($1, $2, 'can', 16, 4)`,
    [packageTypeId, `Replay-only package ${base}`]
  );
  await client.query(
    `INSERT INTO batches (id, batch_code, name, status, volume_bbl)
     VALUES ($1, $2, 'Pkg trigger batch A', 'packaging', 10),
            ($3, $4, 'Pkg trigger batch B', 'packaging', 10)`,
    [batchAId, `PKGTRG-A-${base}`, batchBId, `PKGTRG-B-${base}`]
  );
  await client.query(
    `INSERT INTO packaging_sessions (id, status, session_date)
     VALUES ($1, 'in_progress', CURRENT_DATE)`,
    [sessionId]
  );
  await client.query(
    `INSERT INTO session_line_items
       (id, session_id, brand_id, selling_format_id, package_type_id, batch_id,
        planned_quantity, actual_quantity)
     VALUES ($1, $3, $4, $5, $6, $7, 100, 96),
            ($2, $3, $4, $5, $6, $8, 64, 60)`,
    [lineAId, lineBId, sessionId, brandId, formatId, packageTypeId, batchAId, batchBId]
  );

  // Replay-only xor-constraint shim for the finished_goods rows the DB
  // function inserts (it writes neither legacy format column — live has no
  // such constraint). pg_temp-scoped: vanishes with the session.
  await client.query(`
    CREATE FUNCTION pg_temp.shim_fg_format_xor()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
      IF NEW.package_type_id IS NULL AND NEW.keg_type_id IS NULL THEN
        NEW.package_type_id := '${packageTypeId}'::uuid;
      END IF;
      RETURN NEW;
    END;
    $fn$;
    CREATE TRIGGER shim_fg_format_xor
      BEFORE INSERT ON finished_goods
      FOR EACH ROW EXECUTE FUNCTION pg_temp.shim_fg_format_xor();
  `);

  return { brandId, formatId, batchAId, batchBId, sessionId, lineAId, lineBId };
}

describe("create_finished_goods_from_packaging via on_packaging_session_completion", () => {
  it("creates per-line finished goods, allocations, and lot numbers on completion", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const fx = await seedPackagingFixture(client, 100);

      // A third line with actual_quantity = 0: the current (00232) function
      // SKIPS it (CONTINUE) — the 00145 version raised instead. Assert the
      // current semantics explicitly so a regression either way is visible.
      const batchCId = uid(100 + 10);
      const lineCId = uid(100 + 11);
      await client.query(
        `INSERT INTO batches (id, batch_code, name, status, volume_bbl)
         VALUES ($1, 'PKGTRG-C-100', 'Pkg trigger batch C', 'packaging', 10)`,
        [batchCId]
      );
      await client.query(
        `INSERT INTO session_line_items
           (id, session_id, brand_id, selling_format_id, package_type_id, batch_id,
            planned_quantity, actual_quantity)
         SELECT $1, $2, brand_id, selling_format_id, package_type_id, $3, 10, 0
         FROM session_line_items WHERE id = $4`,
        [lineCId, fx.sessionId, batchCId, fx.lineAId]
      );

      await client.query(
        `UPDATE packaging_sessions SET status = 'completed' WHERE id = $1`,
        [fx.sessionId]
      );

      const fgs = await client.query<{
        batch_id: string;
        brand_id: string;
        selling_format_id: string;
        session_line_item_id: string;
        quantity: number;
        lot_number: string;
      }>(
        `SELECT batch_id, brand_id, selling_format_id, session_line_item_id,
                quantity, lot_number
         FROM finished_goods
         WHERE session_line_item_id IN ($1, $2, $3)
         ORDER BY quantity DESC`,
        [fx.lineAId, fx.lineBId, lineCId]
      );
      expect(fgs.rows).toHaveLength(2); // zero-quantity line C skipped
      expect(fgs.rows[0]).toMatchObject({
        batch_id: fx.batchAId,
        brand_id: fx.brandId,
        selling_format_id: fx.formatId,
        session_line_item_id: fx.lineAId,
        quantity: 96,
      });
      expect(fgs.rows[1]).toMatchObject({
        batch_id: fx.batchBId,
        quantity: 60,
      });
      // Lot numbers: YYYYMMDD-NNN (generate_lot_number, 00142/00205), unique.
      for (const row of fgs.rows) {
        expect(row.lot_number).toMatch(/^\d{8}-\d{3}$/);
      }
      expect(fgs.rows[0].lot_number).not.toBe(fgs.rows[1].lot_number);

      // One completed batch -> finished_good allocation per created row.
      const allocations = await client.query<{
        source_id: string;
        quantity: string;
        status: string;
        lot_number: string;
      }>(
        `SELECT a.source_id, a.quantity, a.status, a.lot_number
         FROM allocations a
         JOIN finished_goods fg ON fg.id = a.destination_id
         WHERE a.source_type = 'batch'
           AND a.destination_type = 'finished_good'
           AND fg.session_line_item_id IN ($1, $2)
         ORDER BY a.quantity DESC`,
        [fx.lineAId, fx.lineBId]
      );
      expect(allocations.rows).toHaveLength(2);
      expect(allocations.rows[0]).toMatchObject({
        source_id: fx.batchAId,
        status: "completed",
        lot_number: fgs.rows[0].lot_number,
      });
      expect(Number(allocations.rows[0].quantity)).toBe(96);
      expect(allocations.rows[1]).toMatchObject({
        source_id: fx.batchBId,
        status: "completed",
      });
      expect(Number(allocations.rows[1].quantity)).toBe(60);

      // 00159 BEFORE UPDATE trigger stamps completed_at.
      const session = await client.query<{ status: string; has_completed_at: boolean }>(
        `SELECT status, completed_at IS NOT NULL AS has_completed_at
         FROM packaging_sessions WHERE id = $1`,
        [fx.sessionId]
      );
      expect(session.rows).toEqual([{ status: "completed", has_completed_at: true }]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("leaves no partial state when a line item fails mid-completion", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const fx = await seedPackagingFixture(client, 200);

      // Injected side-effect failure on batch B's finished_goods insert:
      // batch A's row is inserted first inside the same statement, so a raise
      // on B proves the whole completion (both FG rows, both allocations, the
      // status flip itself) unwinds together — the issue's "no partial state"
      // acceptance criterion. Same idiom as atomic-entity-transitions.test.ts.
      await client.query(`
        CREATE FUNCTION pg_temp.fail_second_line()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $fn$
        BEGIN
          IF NEW.batch_id = '${fx.batchBId}'::uuid THEN
            RAISE EXCEPTION 'injected packaging side-effect failure';
          END IF;
          RETURN NEW;
        END;
        $fn$;
        CREATE TRIGGER fail_second_line
          BEFORE INSERT ON finished_goods
          FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_second_line();
      `);

      await client.query("SAVEPOINT before_completion");
      await expect(
        client.query(
          `UPDATE packaging_sessions SET status = 'completed' WHERE id = $1`,
          [fx.sessionId]
        )
      ).rejects.toThrow("injected packaging side-effect failure");
      await client.query("ROLLBACK TO SAVEPOINT before_completion");

      const fgCount = await client.query<{ n: string }>(
        `SELECT count(*) AS n FROM finished_goods
         WHERE session_line_item_id IN ($1, $2)`,
        [fx.lineAId, fx.lineBId]
      );
      expect(Number(fgCount.rows[0].n)).toBe(0);

      const allocationCount = await client.query<{ n: string }>(
        `SELECT count(*) AS n FROM allocations
         WHERE source_type = 'batch' AND source_id IN ($1, $2)`,
        [fx.batchAId, fx.batchBId]
      );
      expect(Number(allocationCount.rows[0].n)).toBe(0);

      const session = await client.query<{ status: string; completed_at: Date | null }>(
        `SELECT status, completed_at FROM packaging_sessions WHERE id = $1`,
        [fx.sessionId]
      );
      expect(session.rows).toEqual([{ status: "in_progress", completed_at: null }]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("refuses to complete a session with zero line items", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const sessionId = uid(300);
      await client.query(
        `INSERT INTO packaging_sessions (id, status, session_date)
         VALUES ($1, 'in_progress', CURRENT_DATE)`,
        [sessionId]
      );

      await client.query("SAVEPOINT before_completion");
      await expect(
        client.query(
          `UPDATE packaging_sessions SET status = 'completed' WHERE id = $1`,
          [sessionId]
        )
      ).rejects.toThrow(/zero line items/);
      await client.query("ROLLBACK TO SAVEPOINT before_completion");

      const session = await client.query<{ status: string }>(
        `SELECT status FROM packaging_sessions WHERE id = $1`,
        [sessionId]
      );
      expect(session.rows).toEqual([{ status: "in_progress" }]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

describe("revise_packaging_session below-committed guard", () => {
  it("rejects a revision that would reduce a lot below its allocated total", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const fx = await seedPackagingFixture(client, 400);

      await client.query(
        `UPDATE packaging_sessions SET status = 'completed' WHERE id = $1`,
        [fx.sessionId]
      );
      const { rows: fgRows } = await client.query<{ id: string; quantity: number }>(
        `SELECT id, quantity FROM finished_goods WHERE session_line_item_id = $1`,
        [fx.lineAId]
      );
      expect(fgRows).toHaveLength(1);

      // Commit 90 of the 96 units out to an order.
      await client.query(
        `INSERT INTO allocations
           (source_type, source_id, destination_type, destination_id, quantity, status)
         VALUES ('finished_good', $1, 'order', $2, 90, 'planned')`,
        [fgRows[0].id, uid(400 + 20)]
      );

      await client.query("SAVEPOINT before_revision");
      await expect(
        client.query(
          `SELECT revise_packaging_session($1, $2::jsonb)`,
          [
            fx.sessionId,
            JSON.stringify([{ line_item_id: fx.lineAId, actual_quantity: 5 }]),
          ]
        )
      ).rejects.toThrow(/already allocated/);
      await client.query("ROLLBACK TO SAVEPOINT before_revision");

      const after = await client.query<{ quantity: number; status: string; actual_quantity: number }>(
        `SELECT fg.quantity, ps.status, sli.actual_quantity
         FROM finished_goods fg
         JOIN packaging_sessions ps ON ps.id = $2
         JOIN session_line_items sli ON sli.id = $3
         WHERE fg.id = $1`,
        [fgRows[0].id, fx.sessionId, fx.lineAId]
      );
      expect(after.rows).toEqual([
        { quantity: 96, status: "completed", actual_quantity: 96 },
      ]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
