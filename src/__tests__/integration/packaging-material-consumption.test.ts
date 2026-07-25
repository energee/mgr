/**
 * Packaging-completion BOM material depletion (issue #616).
 *
 * Completing a packaging session consumes its BOM materials inside
 * `transition_entity_atomic` (migration 00256). For whole-unit materials
 * (`each`, `case`) that branch originally ceiled the product of the stored
 * 4-decimal `quantity_per_unit`:
 *
 *   CEIL(SUM(li.actual_quantity * sfm.quantity_per_unit) - 1e-9)
 *
 * A "1 per 24" BOM line stores as `0.0417`, so 240 cans computed
 * `CEIL(10.008) = 11` cases — one more than the ratio-aware preview the
 * operator had just approved, and one more than physical reality. Migration
 * 00279 factors the ratio recovery into `exact_material_qty()` and ceils the
 * per-(batch, item) group total once, matching `computeBomConsumption`.
 *
 * These tests drive the real RPC against real Postgres. All of them run inside
 * BEGIN/ROLLBACK; nothing is committed.
 */

import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { WHOLE_UNIT_PARITY_CASES } from "@/test/whole-unit-parity-fixtures";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

afterAll(async () => {
  await pool.end();
});

/**
 * Deterministic UUID namespace for this suite: issue 0616, sub-range 0001.
 * `base` offsets each test's fixture so concurrently running suites never
 * collide on ids even before their transactions roll back.
 */
function uid(n: number): string {
  return `00000000-0000-0000-0616-0001${String(n).padStart(8, "0")}`;
}

type MaterialSpec = {
  /** BOM quantity_per_unit as stored (4-decimal truncation already applied). */
  qpu: number;
  /** Units packaged against this selling format. */
  units: number;
};

type Fixture = {
  sessionId: string;
  itemId: string;
  batchId: string;
};

/**
 * Seeds one in_progress packaging session whose line items all draw on a
 * single inventory item, one selling format per `MaterialSpec`. A single lot
 * with ample quantity backs the item so FIFO never short-draws and the summed
 * allocation quantity equals the computed demand exactly.
 */
async function seedSession(
  client: import("pg").PoolClient,
  base: number,
  unit: string,
  specs: MaterialSpec[]
): Promise<Fixture> {
  const brandId = uid(base + 1);
  const containerId = uid(base + 2);
  const batchId = uid(base + 3);
  const sessionId = uid(base + 4);
  const itemId = uid(base + 5);
  const lotId = uid(base + 6);

  await client.query(`INSERT INTO brands (id, name) VALUES ($1, $2)`, [
    brandId,
    `BOM ceiling brand ${base}`,
  ]);
  await client.query(
    `INSERT INTO containers (id, name, type, volume_oz)
     VALUES ($1, $2, 'package', 16)`,
    [containerId, `BOM ceiling can ${base}`]
  );
  await client.query(
    `INSERT INTO batches (id, batch_code, name, status, volume_bbl)
     VALUES ($1, $2, 'BOM ceiling batch', 'packaging', 50)`,
    [batchId, `BOMCEIL-${base}`]
  );
  await client.query(
    `INSERT INTO inventory_items (id, category, name, unit)
     VALUES ($1, 'packaging', $2, $3)`,
    [itemId, `BOM ceiling material ${base}`, unit]
  );
  await client.query(
    `INSERT INTO inventory_lots (id, inventory_item_id, lot_number, quantity, unit, unit_cost)
     VALUES ($1, $2, $3, 100000, $4, 1)`,
    [lotId, itemId, `LOT-BOMCEIL-${base}`, unit]
  );
  await client.query(
    `INSERT INTO packaging_sessions (id, status, session_date)
     VALUES ($1, 'in_progress', CURRENT_DATE)`,
    [sessionId]
  );

  for (const [i, spec] of specs.entries()) {
    const formatId = uid(base + 10 + i * 2);
    const lineId = uid(base + 11 + i * 2);
    await client.query(
      `INSERT INTO selling_formats (id, container_id, name, unit_count)
       VALUES ($1, $2, $3, 1)`,
      [formatId, containerId, `BOM ceiling format ${base}-${i}`]
    );
    await client.query(
      `INSERT INTO selling_format_materials (selling_format_id, inventory_item_id, quantity_per_unit)
       VALUES ($1, $2, $3)`,
      [formatId, itemId, spec.qpu]
    );
    await client.query(
      `INSERT INTO session_line_items
         (id, session_id, brand_id, selling_format_id, batch_id,
          planned_quantity, actual_quantity)
       VALUES ($1, $2, $3, $4, $5, $6, $6)`,
      [lineId, sessionId, brandId, formatId, batchId, spec.units]
    );
  }

  return { sessionId, itemId, batchId };
}

/** Completes the session through the RPC and returns the material consumed. */
async function completeAndSumConsumption(
  client: import("pg").PoolClient,
  fx: Fixture
): Promise<number> {
  await client.query(
    `SELECT transition_entity_atomic('packaging_sessions', $1, 'in_progress', 'completed', '{}'::jsonb)`,
    [fx.sessionId]
  );
  const consumed = await client.query<{ total: string | null }>(
    `SELECT SUM(a.quantity)::text AS total
     FROM allocations a
     JOIN inventory_lots lot ON lot.id = a.source_id
     WHERE a.idempotency_key = $1
       AND a.source_type = 'inventory_lot'
       AND lot.inventory_item_id = $2`,
    [`pkg_session:${fx.sessionId}`, fx.itemId]
  );
  return Number(consumed.rows[0]?.total ?? 0);
}

describe("transition_entity_atomic packaging material depletion", () => {
  it("consumes 10 cases for 240 units at a stored 1-per-24 ratio, not 11", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const fx = await seedSession(client, 100, "each", [{ qpu: 0.0417, units: 240 }]);
      expect(await completeAndSumConsumption(client, fx)).toBe(10);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("consumes 1 case for 24 units at a stored 1-per-24 ratio", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const fx = await seedSession(client, 200, "each", [{ qpu: 0.0417, units: 24 }]);
      expect(await completeAndSumConsumption(client, fx)).toBe(1);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("consumes 1 unit for 6 units at a stored 1-per-6 ratio", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const fx = await seedSession(client, 300, "case", [{ qpu: 0.1667, units: 6 }]);
      expect(await completeAndSumConsumption(client, fx)).toBe(1);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  // The group total is ceiled ONCE per (batch, inventory_item): two formats
  // each needing half a case must book one case, not two. This is the
  // per-batch ceiling semantic 00217's M8 note fixed, and the reason the fix
  // sums an exact (non-ceiling) helper rather than ceiling per line item.
  it("ceils the (batch, item) group total once across selling formats", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const fx = await seedSession(client, 400, "each", [
        { qpu: 0.0417, units: 12 },
        { qpu: 0.0417, units: 12 },
      ]);
      expect(await completeAndSumConsumption(client, fx)).toBe(1);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("leaves bulk (non each/case) materials unceiled and proportional", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const fx = await seedSession(client, 500, "lb", [{ qpu: 0.0417, units: 240 }]);
      // 240 * 0.0417 = 10.008 — bulk consumption keeps the raw product.
      expect(await completeAndSumConsumption(client, fx)).toBeCloseTo(10.008, 6);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("re-running the transition is a no-op via the pkg_session idempotency key", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const fx = await seedSession(client, 600, "each", [{ qpu: 0.0417, units: 240 }]);
      expect(await completeAndSumConsumption(client, fx)).toBe(10);
      // The state machine has no completed -> in_progress edge and
      // packaging_session_before_update enforces it, so rewinding the status to
      // replay the depletion needs the guards off. Disabling triggers is
      // transactional and reverts with the ROLLBACK below; what is under test
      // is the RPC's own `NOT EXISTS (... idempotency_key = 'pkg_session:<id>')`
      // guard, which must add nothing on the second pass.
      await client.query(`ALTER TABLE packaging_sessions DISABLE TRIGGER USER`);
      await client.query(
        `UPDATE packaging_sessions SET status = 'in_progress' WHERE id = $1`,
        [fx.sessionId]
      );
      await client.query(`ALTER TABLE packaging_sessions ENABLE TRIGGER USER`);
      expect(await completeAndSumConsumption(client, fx)).toBe(10);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

describe("SQL ↔ TS whole-unit ceiling parity", () => {
  // Same fixture table the TS side asserts in
  // src/domain/__tests__/consumption-planning.test.ts, so the two ceilings
  // cannot drift.
  it.each(WHOLE_UNIT_PARITY_CASES)(
    "whole_unit_material_qty(%s, %s) = %s",
    async (qpu, units, expected) => {
      const client = await pool.connect();
      try {
        const result = await client.query<{ qty: string }>(
          `SELECT whole_unit_material_qty($1::numeric, $2::numeric)::text AS qty`,
          [qpu, units]
        );
        expect(Number(result.rows[0].qty)).toBe(expected);
      } finally {
        client.release();
      }
    }
  );

  it("exact_material_qty is the unceiled core of whole_unit_material_qty", async () => {
    const client = await pool.connect();
    try {
      const result = await client.query<{ exact: string; ceiled: string }>(
        `SELECT exact_material_qty(0.0417, 240)::text AS exact,
                whole_unit_material_qty(0.0417, 240)::text AS ceiled`
      );
      // 240 * (1/24) = 10 exactly — the raw decimal would give 10.008.
      expect(Number(result.rows[0].exact)).toBe(10);
      expect(Number(result.rows[0].ceiled)).toBe(10);
    } finally {
      client.release();
    }
  });
});
