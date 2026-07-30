/**
 * Allocation fulfillment and cancellation against real Postgres (issue #437,
 * acceptance criteria 5 and 6).
 *
 * Drives the order arms of `transition_entity_atomic` (00256):
 *  - orders -> fulfilled: completes the planned finished_good -> order
 *    reservations, stamps completed_at, and back-fills volume_bbl from the
 *    selling format so the removal can be reported on Form 5130.9; when an
 *    order carries no reservations at all it synthesizes deterministic FIFO
 *    removals from the order lines instead.
 *  - orders -> cancelled: releases the planned reservations only.
 *
 * The failure-path tests are the point of criterion 6: each asserts the
 * ABSENCE of partial state after an injected failure — the order status, every
 * allocation's status/completed_at/volume_bbl, and the resulting available
 * stock — not merely that an error was raised.
 *
 * "Deterministic FIFO" is pinned by `draws the oldest lot first`, which orders
 * the two lots' lot_numbers against their production dates and demands less
 * than the total stock, so the draw sizes differ under FIFO and under any other
 * order. The shortfall case deliberately drains both lots and therefore says
 * nothing about ordering.
 *
 * Every availability number goes through `availableUnits`, which checks itself
 * against `guard_allocation_availability` rather than only re-implementing it.
 *
 * All tests run inside BEGIN/ROLLBACK; nothing is committed.
 *
 * Run locally:   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
 *                bun run test:integration
 */

import { afterAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

import { requireDatabaseUrl } from "./_helpers/role-client";

const pool = new Pool({ connectionString: requireDatabaseUrl() });

/** Deterministic UUID namespace for this suite: issue 0437, sub-range 0004. */
function uid(n: number): string {
  return `00000000-0000-0000-0437-0004${String(n).padStart(8, "0")}`;
}

afterAll(async () => {
  await pool.end();
});

type Fixture = {
  formatId: string;
  brandId: string;
  orderId: string;
  fgAId: string;
  fgBId: string;
};

/**
 * Seeds a brand, a 0.5 bbl selling format, two finished-goods lots (A: 60
 * units, B: 40 units) and one order in `packed`.
 *
 * 1984 fl oz is exactly 0.5 bbl (1 bbl = 3968 fl oz): the fulfillment arm
 * computes volume_bbl as quantity * unit_count * volume_oz / 3968.0, so a
 * container volume that does not divide 3968 would make every expected volume
 * approximate. Type 'package' (containers_type_check allows only 'package' and
 * 'keg') keeps these lines out of the keg-transaction paths, which cannot
 * complete on a replayed chain at all (issue #701).
 */
async function seedOrderFixture(client: PoolClient, base: number): Promise<Fixture> {
  const brandId = uid(base + 1);
  const containerId = uid(base + 2);
  const formatId = uid(base + 3);
  const orderId = uid(base + 4);
  const fgAId = uid(base + 5);
  const fgBId = uid(base + 6);

  await client.query(`INSERT INTO brands (id, name) VALUES ($1, $2)`, [
    brandId,
    `Fulfillment brand ${base}`,
  ]);
  await client.query(
    `INSERT INTO containers (id, name, type, volume_oz)
     VALUES ($1, $2, 'package', 1984)`,
    [containerId, `Fulfillment 0.5 bbl package ${base}`]
  );
  await client.query(
    `INSERT INTO selling_formats (id, container_id, name, unit_count)
     VALUES ($1, $2, $3, 1)`,
    [formatId, containerId, `Fulfillment single unit ${base}`]
  );
  // 00256 orders the synthesized draw `production_date NULLS LAST, lot_number
  // NULLS LAST, id`. Lot A is the older one. Note that lot_number sorts the
  // same way here, so these two lots alone cannot show WHICH term ordered the
  // draw — `draws the oldest lot first` re-numbers them to separate the two.
  await client.query(
    `INSERT INTO finished_goods
       (id, brand_id, selling_format_id, quantity, lot_number, production_date)
     VALUES ($1, $3, $4, 60, $5, DATE '2026-01-02'),
            ($2, $3, $4, 40, $6, DATE '2026-01-09')`,
    [fgAId, fgBId, brandId, formatId, `FULFIL-A-${base}`, `FULFIL-B-${base}`]
  );
  await client.query(
    `INSERT INTO orders (id, order_number, status, order_date)
     VALUES ($1, $2, 'packed', CURRENT_DATE)`,
    [orderId, `FULFIL-${base}`]
  );

  return { formatId, brandId, orderId, fgAId, fgBId };
}

/**
 * Opens a transaction with bounded lock waits.
 *
 * The failure-path tests here issue CREATE TRIGGER on `allocations`, which
 * takes ACCESS EXCLUSIVE on a table every sibling suite touches and holds it
 * until this transaction ends. Unbounded, contention shows up as an opaque
 * `Test timed out in 15000ms`; bounded, Postgres names the statement that
 * could not get its lock. Both values sit under vitest's 15s testTimeout so the
 * database error wins the race. Same rationale as
 * inventory-guard-concurrency.test.ts's `beginBounded`.
 */
async function beginBounded(client: PoolClient): Promise<void> {
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query("SET LOCAL statement_timeout = '10s'");
}

/**
 * Units still sellable out of a finished-goods lot, cross-checked against the
 * database's own guard.
 *
 * The SELECT mirrors `guard_allocation_availability` (00212): stock minus every
 * planned-or-completed allocation off the same source. A test helper that only
 * re-implements the rule would stay green if the server changed how
 * availability is computed, with the guard and the assertions quietly
 * disagreeing — so the number is then verified against the guard itself, by
 * probing both sides of the boundary inside savepoints that are rolled back:
 * an allocation of exactly `available` units must be accepted, and one unit
 * more must be rejected. That pins the helper to the server's behaviour rather
 * than to a copy of its source.
 */
async function availableUnits(client: PoolClient, fgId: string): Promise<number> {
  const { rows } = await client.query<{ available: string }>(
    `SELECT fg.quantity - COALESCE((
       SELECT SUM(a.quantity) FROM allocations a
       WHERE a.source_type = 'finished_good' AND a.source_id = fg.id
         AND a.status IN ('planned', 'completed')
     ), 0) AS available
     FROM finished_goods fg WHERE fg.id = $1`,
    [fgId]
  );
  const available = Number(rows[0].available);

  const probe = (quantity: number) =>
    client.query(
      `INSERT INTO allocations
         (source_type, source_id, destination_type, destination_id, quantity, status)
       VALUES ('finished_good', $1, 'order', gen_random_uuid(), $2, 'planned')`,
      [fgId, quantity]
    );

  if (available > 0) {
    await client.query("SAVEPOINT availability_probe");
    await probe(available);
    await client.query("ROLLBACK TO SAVEPOINT availability_probe");
    await client.query("RELEASE SAVEPOINT availability_probe");
  }
  await client.query("SAVEPOINT availability_probe");
  await expect(probe(available + 1)).rejects.toThrow(/exceeds availability/);
  await client.query("ROLLBACK TO SAVEPOINT availability_probe");
  await client.query("RELEASE SAVEPOINT availability_probe");

  return available;
}

type AllocationRow = {
  id: string;
  source_id: string;
  status: string;
  completed_at: Date | null;
  volume_bbl: string | null;
  quantity: string;
};

async function readAllocations(
  client: PoolClient,
  orderId: string
): Promise<AllocationRow[]> {
  const { rows } = await client.query<AllocationRow>(
    `SELECT id, source_id, status, completed_at, volume_bbl, quantity
     FROM allocations
     WHERE destination_type = 'order' AND destination_id = $1
     ORDER BY quantity DESC, id`,
    [orderId]
  );
  return rows;
}

/** Units drawn per source lot, keyed by finished-goods id. */
function drawsByLot(allocations: AllocationRow[]): Record<string, number> {
  return Object.fromEntries(allocations.map((a) => [a.source_id, Number(a.quantity)]));
}

describe("orders -> fulfilled completes reservations atomically", () => {
  it("completes every reservation and back-fills its removal volume", async () => {
    const client = await pool.connect();
    try {
      await beginBounded(client);
      const fx = await seedOrderFixture(client, 100);
      await client.query(
        `INSERT INTO allocations
           (id, source_type, source_id, destination_type, destination_id, quantity, status)
         VALUES ($1, 'finished_good', $3, 'order', $5, 60, 'planned'),
                ($2, 'finished_good', $4, 'order', $5, 40, 'planned')`,
        [uid(110), uid(111), fx.fgAId, fx.fgBId, fx.orderId]
      );

      const { rows: result } = await client.query<{
        transition_entity_atomic: { completed_allocations: number; shortfalls: number };
      }>(
        `SELECT transition_entity_atomic('orders', $1, 'packed', 'fulfilled', '{}'::jsonb)`,
        [fx.orderId]
      );
      expect(result[0].transition_entity_atomic).toMatchObject({
        completed_allocations: 2,
        shortfalls: 0,
      });

      const allocations = await readAllocations(client, fx.orderId);
      expect(allocations.map((a) => a.status)).toEqual(["completed", "completed"]);
      expect(allocations.every((a) => a.completed_at !== null)).toBe(true);
      // 60 and 40 units of a 0.5 bbl format. Without volume_bbl the removal is
      // invisible to get_ttb_removals_summary, which sums that column.
      expect(allocations.map((a) => Number(a.volume_bbl))).toEqual([30, 20]);

      const { rows: order } = await client.query<{
        status: string;
        has_fulfilled_date: boolean;
      }>(
        `SELECT status, fulfilled_date IS NOT NULL AS has_fulfilled_date
         FROM orders WHERE id = $1`,
        [fx.orderId]
      );
      expect(order).toEqual([{ status: "fulfilled", has_fulfilled_date: true }]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("draws the oldest lot first", async () => {
    const client = await pool.connect();
    try {
      await beginBounded(client);
      const fx = await seedOrderFixture(client, 700);
      // Make lot_number sort AGAINST production_date: the older lot (A,
      // 2026-01-02) takes the alphabetically last number. 00256 orders the draw
      // `production_date NULLS LAST, lot_number NULLS LAST, id`; with the
      // fixture's default numbering both terms agree and a regression that
      // dropped the date term would be invisible. Re-numbered, only a draw
      // ordered by production_date produces the quantities below.
      await client.query(`UPDATE finished_goods SET lot_number = $2 WHERE id = $1`, [
        fx.fgAId,
        "FULFIL-Z-700",
      ]);
      await client.query(`UPDATE finished_goods SET lot_number = $2 WHERE id = $1`, [
        fx.fgBId,
        "FULFIL-A-700",
      ]);

      // 70 of the 100 units in stock. FIFO drains the older 60-unit lot and
      // tops up with 10 from the newer one; any other order — LIFO, or
      // lot_number ascending — draws 40 from B first and 30 from A.
      await client.query(
        `INSERT INTO order_items (id, order_id, brand_id, selling_format_id, quantity)
         VALUES ($1, $2, $3, $4, 70)`,
        [uid(710), fx.orderId, fx.brandId, fx.formatId]
      );

      const { rows: result } = await client.query<{
        transition_entity_atomic: { completed_allocations: number; shortfalls: number };
      }>(
        `SELECT transition_entity_atomic('orders', $1, 'packed', 'fulfilled', '{}'::jsonb)`,
        [fx.orderId]
      );
      expect(result[0].transition_entity_atomic).toMatchObject({
        completed_allocations: 2,
        shortfalls: 0,
      });

      const allocations = await readAllocations(client, fx.orderId);
      expect(drawsByLot(allocations)).toEqual({ [fx.fgAId]: 60, [fx.fgBId]: 10 });
      // 0.5 bbl a unit: 30 bbl off the old lot, 5 off the new one.
      expect(allocations.map((a) => Number(a.volume_bbl))).toEqual([30, 5]);
      // ...and the untouched 30 units of the newer lot are still sellable.
      expect(await availableUnits(client, fx.fgAId)).toBe(0);
      expect(await availableUnits(client, fx.fgBId)).toBe(30);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("surfaces the shortfall without overselling when stock runs out", async () => {
    const client = await pool.connect();
    try {
      await beginBounded(client);
      const fx = await seedOrderFixture(client, 200);
      // 140 units ordered against 100 units of stock.
      await client.query(
        `INSERT INTO order_items (id, order_id, brand_id, selling_format_id, quantity)
         VALUES ($1, $2, $3, $4, 140)`,
        [uid(210), fx.orderId, fx.brandId, fx.formatId]
      );

      const { rows: result } = await client.query<{
        transition_entity_atomic: { completed_allocations: number; shortfalls: number };
      }>(
        `SELECT transition_entity_atomic('orders', $1, 'packed', 'fulfilled', '{}'::jsonb)`,
        [fx.orderId]
      );
      // Two synthesized removals (one per lot), and the 40-unit shortfall is
      // surfaced rather than silently satisfied.
      expect(result[0].transition_entity_atomic).toMatchObject({
        completed_allocations: 2,
        shortfalls: 1,
      });

      // Both lots drain completely here, so these numbers are the same in any
      // draw order — this test is about the shortfall, not about FIFO, and
      // `draws the oldest lot first` is what pins the ordering.
      const allocations = await readAllocations(client, fx.orderId);
      expect(drawsByLot(allocations)).toEqual({ [fx.fgAId]: 60, [fx.fgBId]: 40 });
      expect(allocations.map((a) => Number(a.volume_bbl))).toEqual([30, 20]);

      // The divergence this guards against: a shortfall must never be papered
      // over by drawing stock that does not exist.
      expect(await availableUnits(client, fx.fgAId)).toBe(0);
      expect(await availableUnits(client, fx.fgBId)).toBe(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

describe("orders -> fulfilled failure leaves no partial ledger", () => {
  it("rolls back every reservation when one of them fails", async () => {
    const client = await pool.connect();
    try {
      await beginBounded(client);
      const fx = await seedOrderFixture(client, 300);
      await client.query(
        `INSERT INTO allocations
           (id, source_type, source_id, destination_type, destination_id, quantity, status)
         VALUES ($1, 'finished_good', $3, 'order', $5, 60, 'planned'),
                ($2, 'finished_good', $4, 'order', $5, 40, 'planned')`,
        [uid(310), uid(311), fx.fgAId, fx.fgBId, fx.orderId]
      );

      // Fulfillment completes both reservations in ONE set-based UPDATE, so a
      // raise on either row must unwind the other as well — whichever order
      // the executor happens to visit them in.
      await client.query(`
        CREATE FUNCTION pg_temp.fail_second_reservation()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $fn$
        BEGIN
          IF NEW.id = '${uid(311)}'::uuid AND NEW.status = 'completed' THEN
            RAISE EXCEPTION 'injected fulfillment ledger failure';
          END IF;
          RETURN NEW;
        END;
        $fn$;
        CREATE TRIGGER fail_second_reservation
          BEFORE UPDATE ON allocations
          FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_second_reservation();
      `);

      await client.query("SAVEPOINT before_fulfillment");
      await expect(
        client.query(
          `SELECT transition_entity_atomic('orders', $1, 'packed', 'fulfilled', '{}'::jsonb)`,
          [fx.orderId]
        )
      ).rejects.toThrow("injected fulfillment ledger failure");
      await client.query("ROLLBACK TO SAVEPOINT before_fulfillment");
      // Uninstall before asserting: everything below observes the database in
      // its normal state, including `availableUnits`, which probes the real
      // availability guard with writes of its own.
      await client.query("DROP TRIGGER fail_second_reservation ON allocations");

      const { rows: order } = await client.query<{
        status: string;
        fulfilled_date: string | null;
      }>(`SELECT status, fulfilled_date FROM orders WHERE id = $1`, [fx.orderId]);
      expect(order).toEqual([{ status: "packed", fulfilled_date: null }]);

      // Neither reservation was completed, and neither carries a removal
      // volume — a half-completed order would report a removal for beer the
      // customer never received.
      const allocations = await readAllocations(client, fx.orderId);
      expect(allocations).toHaveLength(2);
      for (const allocation of allocations) {
        expect(allocation.status).toBe("planned");
        expect(allocation.completed_at).toBeNull();
        expect(allocation.volume_bbl).toBeNull();
      }

      // Stock is exactly as reserved: still committed, not yet removed.
      expect(await availableUnits(client, fx.fgAId)).toBe(0);
      expect(await availableUnits(client, fx.fgBId)).toBe(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("writes no synthesized removal at all when one of them fails", async () => {
    const client = await pool.connect();
    try {
      await beginBounded(client);
      const fx = await seedOrderFixture(client, 400);
      // Two order lines, so the synthesized-removal loop runs twice; the second
      // line's draw fails.
      await client.query(
        `INSERT INTO order_items (id, order_id, brand_id, selling_format_id, quantity)
         VALUES ($1, $3, $4, $5, 60), ($2, $3, $4, $5, 40)`,
        [uid(410), uid(411), fx.orderId, fx.brandId, fx.formatId]
      );
      await client.query(`
        CREATE FUNCTION pg_temp.fail_second_draw()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $fn$
        BEGIN
          IF NEW.source_id = '${fx.fgBId}'::uuid THEN
            RAISE EXCEPTION 'injected synthesized-removal failure';
          END IF;
          RETURN NEW;
        END;
        $fn$;
        CREATE TRIGGER fail_second_draw
          BEFORE INSERT ON allocations
          FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_second_draw();
      `);

      await client.query("SAVEPOINT before_fulfillment");
      await expect(
        client.query(
          `SELECT transition_entity_atomic('orders', $1, 'packed', 'fulfilled', '{}'::jsonb)`,
          [fx.orderId]
        )
      ).rejects.toThrow("injected synthesized-removal failure");
      await client.query("ROLLBACK TO SAVEPOINT before_fulfillment");
      await client.query("DROP TRIGGER fail_second_draw ON allocations");

      // The first line's removal was already inserted when the second raised;
      // it must not survive, or the brewery has shipped 60 units against an
      // order that is still sitting in `packed`.
      expect(await readAllocations(client, fx.orderId)).toEqual([]);
      expect(await availableUnits(client, fx.fgAId)).toBe(60);
      expect(await availableUnits(client, fx.fgBId)).toBe(40);

      const { rows: order } = await client.query<{ status: string }>(
        `SELECT status FROM orders WHERE id = $1`,
        [fx.orderId]
      );
      expect(order).toEqual([{ status: "packed" }]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

describe("orders -> cancelled releases reservations without reversing removals", () => {
  it("cancels planned reservations and returns their stock", async () => {
    const client = await pool.connect();
    try {
      await beginBounded(client);
      const fx = await seedOrderFixture(client, 500);
      // Lot B: 20 units already shipped (completed). Lot A: 40 still reserved.
      // (Two lots because idx_allocations_unique_active_source_dest forbids two
      // active allocations sharing one source/destination pair.)
      await client.query(
        `INSERT INTO allocations
           (id, source_type, source_id, destination_type, destination_id,
            quantity, volume_bbl, status, completed_at)
         VALUES ($1, 'finished_good', $3, 'order', $5, 20, 10, 'completed', NOW()),
                ($2, 'finished_good', $4, 'order', $5, 40, NULL, 'planned', NULL)`,
        [uid(510), uid(511), fx.fgBId, fx.fgAId, fx.orderId]
      );
      expect(await availableUnits(client, fx.fgAId)).toBe(20);
      expect(await availableUnits(client, fx.fgBId)).toBe(20);

      await client.query(
        `SELECT transition_entity_atomic('orders', $1, 'packed', 'cancelled', '{}'::jsonb)`,
        [fx.orderId]
      );

      const allocations = await readAllocations(client, fx.orderId);
      expect(allocations.map((a) => [Number(a.quantity), a.status])).toEqual([
        [40, "cancelled"],
        [20, "completed"],
      ]);
      // Cancelling an order must NOT un-remove beer that already left: the
      // completed removal keeps its status, timestamp and reported volume.
      const shipped = allocations.find((a) => Number(a.quantity) === 20);
      expect(shipped?.completed_at).not.toBeNull();
      expect(Number(shipped?.volume_bbl)).toBe(10);

      // Only the released 40 units come back; the shipped 20 stay gone.
      expect(await availableUnits(client, fx.fgAId)).toBe(60);
      expect(await availableUnits(client, fx.fgBId)).toBe(20);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("leaves reservations committed when the cancellation fails", async () => {
    const client = await pool.connect();
    try {
      await beginBounded(client);
      const fx = await seedOrderFixture(client, 600);
      await client.query(
        `INSERT INTO allocations
           (id, source_type, source_id, destination_type, destination_id, quantity, status)
         VALUES ($1, 'finished_good', $2, 'order', $3, 40, 'planned')`,
        [uid(610), fx.fgAId, fx.orderId]
      );
      await client.query(`
        CREATE FUNCTION pg_temp.fail_release()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $fn$
        BEGIN
          IF NEW.status = 'cancelled' THEN
            RAISE EXCEPTION 'injected reservation release failure';
          END IF;
          RETURN NEW;
        END;
        $fn$;
        CREATE TRIGGER fail_release
          BEFORE UPDATE ON allocations
          FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_release();
      `);

      await client.query("SAVEPOINT before_cancel");
      await expect(
        client.query(
          `SELECT transition_entity_atomic('orders', $1, 'packed', 'cancelled', '{}'::jsonb)`,
          [fx.orderId]
        )
      ).rejects.toThrow("injected reservation release failure");
      await client.query("ROLLBACK TO SAVEPOINT before_cancel");
      await client.query("DROP TRIGGER fail_release ON allocations");

      // A cancelled order whose reservations were never released would strand
      // the stock; a released reservation on a still-open order would let it be
      // sold twice. Neither half may land alone.
      const { rows: order } = await client.query<{ status: string }>(
        `SELECT status FROM orders WHERE id = $1`,
        [fx.orderId]
      );
      expect(order).toEqual([{ status: "packed" }]);
      const allocations = await readAllocations(client, fx.orderId);
      expect(allocations.map((a) => a.status)).toEqual(["planned"]);
      expect(await availableUnits(client, fx.fgAId)).toBe(20);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
