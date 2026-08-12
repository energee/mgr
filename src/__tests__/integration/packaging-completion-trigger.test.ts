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
 * Line items are seeded selling_format-only (the live shape): migration
 * 00269 captured live's out-of-band drop of the legacy 00080 xor
 * constraints, so replayed chains accept these rows directly — the pg_temp
 * stamping shim this suite previously carried is gone (#559).
 *
 * The last describe block covers the keg half of the same function (#701).
 * Until 00283 a chain-built database could not complete a keg-container
 * session at all: the fill keg_transactions insert omitted keg_type_id, NOT
 * NULL since 00032, so the completion aborted with "null value in column
 * keg_type_id ... violates not-null constraint". 00283 retires that column,
 * which is the shape live has had since the container/selling-format refactor.
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
       (id, session_id, brand_id, selling_format_id, batch_id,
        planned_quantity, actual_quantity)
     VALUES ($1, $3, $4, $5, $6, 100, 96),
            ($2, $3, $4, $5, $7, 64, 60)`,
    [lineAId, lineBId, sessionId, brandId, formatId, batchAId, batchBId]
  );

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
           (id, session_id, brand_id, selling_format_id, batch_id,
            planned_quantity, actual_quantity)
         SELECT $1, $2, brand_id, selling_format_id, $3, 10, 0
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

      const after = await client.query<{ quantity: number; status: string; actual_quantity: string }>(
        `SELECT fg.quantity, ps.status, sli.actual_quantity
         FROM finished_goods fg
         JOIN packaging_sessions ps ON ps.id = $2
         JOIN session_line_items sli ON sli.id = $3
         WHERE fg.id = $1`,
        [fgRows[0].id, fx.sessionId, fx.lineAId]
      );
      // actual_quantity is NUMERIC (since 00288, for fractional MongoDB quantities),
      // so the pg driver returns it as a string rather than a number.
      expect(after.rows).toEqual([
        { quantity: 96, status: "completed", actual_quantity: "96" },
      ]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

describe("keg-container packaging completion (#701)", () => {
  /**
   * Seeds the keg counterpart of `seedPackagingFixture`: brand -> keg
   * container -> selling format -> packaging-state batch -> in_progress
   * session with one line item for 17 kegs.
   *
   * The container is created here rather than reused from a fixture because
   * `containers.type = 'keg'` is exactly what
   * `create_finished_goods_from_packaging` branches on when deciding to write
   * the fill transaction (00183 onward: selling_formats -> containers).
   */
  async function seedKegFixture(client: import("pg").PoolClient, base: number) {
    const brandId = uid(base + 1);
    const containerId = uid(base + 2);
    const formatId = uid(base + 3);
    const batchId = uid(base + 4);
    const sessionId = uid(base + 5);
    const lineId = uid(base + 6);

    await client.query(`INSERT INTO brands (id, name) VALUES ($1, $2)`, [
      brandId,
      `Keg fill brand ${base}`,
    ]);
    await client.query(
      `INSERT INTO containers (id, name, type, volume_bbl)
       VALUES ($1, $2, 'keg', 0.5)`,
      [containerId, `Keg fill half barrel ${base}`]
    );
    await client.query(
      `INSERT INTO selling_formats (id, container_id, name, unit_count)
       VALUES ($1, $2, 'Per Keg', 1)`,
      [formatId, containerId]
    );
    await client.query(
      `INSERT INTO batches (id, batch_code, name, status, volume_bbl)
       VALUES ($1, $2, 'Keg fill batch', 'packaging', 10)`,
      [batchId, `KEGFILL-${base}`]
    );
    await client.query(
      `INSERT INTO packaging_sessions (id, status, session_date)
       VALUES ($1, 'in_progress', CURRENT_DATE)`,
      [sessionId]
    );
    await client.query(
      `INSERT INTO session_line_items
         (id, session_id, brand_id, selling_format_id, batch_id,
          planned_quantity, actual_quantity)
       VALUES ($1, $2, $3, $4, $5, 20, 17)`,
      [lineId, sessionId, brandId, formatId, batchId]
    );

    return { brandId, containerId, formatId, batchId, sessionId, lineId };
  }

  it("records the fill keg_transaction for a keg-container line item", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const fx = await seedKegFixture(client, 500);

      // Pre-00283 this UPDATE raised:
      //   null value in column "keg_type_id" of relation "keg_transactions"
      //   violates not-null constraint
      await client.query(
        `UPDATE packaging_sessions SET status = 'completed' WHERE id = $1`,
        [fx.sessionId]
      );

      const { rows: fgRows } = await client.query<{ id: string }>(
        `SELECT id FROM finished_goods WHERE session_line_item_id = $1`,
        [fx.lineId]
      );
      expect(fgRows).toHaveLength(1);

      const { rows: txns } = await client.query<{
        transaction_type: string;
        selling_format_id: string;
        container_type: string;
        quantity: number;
        from_state: string;
        to_state: string;
        batch_id: string;
        finished_good_id: string;
      }>(
        `SELECT kt.transaction_type, kt.selling_format_id, c.type AS container_type,
                kt.quantity, kt.from_state, kt.to_state, kt.batch_id,
                kt.finished_good_id
         FROM keg_transactions kt
         JOIN selling_formats sf ON sf.id = kt.selling_format_id
         JOIN containers c ON c.id = sf.container_id
         WHERE kt.packaging_session_id = $1`,
        [fx.sessionId]
      );

      // The keg identity of the fill: a non-null selling_format_id whose
      // container is a keg. That is what replaced keg_type_id — the join
      // above fails if selling_format_id is ever left null.
      expect(txns).toHaveLength(1);
      expect(txns[0]).toMatchObject({
        transaction_type: "fill",
        selling_format_id: fx.formatId,
        container_type: "keg",
        quantity: 17,
        from_state: "empty",
        to_state: "filled",
        batch_id: fx.batchId,
        finished_good_id: fgRows[0].id,
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("writes no keg_transaction for a package-container line item", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const fx = await seedPackagingFixture(client, 600);

      await client.query(
        `UPDATE packaging_sessions SET status = 'completed' WHERE id = $1`,
        [fx.sessionId]
      );

      const { rows } = await client.query<{ n: string }>(
        `SELECT count(*) AS n FROM keg_transactions WHERE packaging_session_id = $1`,
        [fx.sessionId]
      );
      expect(Number(rows[0].n)).toBe(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("has no legacy keg_type_id column on keg_transactions", async () => {
    const client = await pool.connect();
    try {
      // Schema contract, asserted the same way square-draft-sales-schema.test.ts
      // pins the sibling retirement (00254): a replay that restores the
      // column also restores the NOT NULL that broke every keg write path.
      const { rows } = await client.query<{ column_name: string }>(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'keg_transactions'
           AND column_name IN ('keg_type_id', 'selling_format_id')
         ORDER BY column_name`
      );
      expect(rows.map((r) => r.column_name)).toEqual(["selling_format_id"]);
    } finally {
      client.release();
    }
  });
});
