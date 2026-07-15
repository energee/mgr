/**
 * Real-Postgres regressions for atomic Square sale/refund ingestion (#443).
 *
 * These tests exercise the database transaction boundary directly. Route
 * mocks can prove which RPC is called, but only Postgres can prove that a
 * failure after ledger/bin/draft writes rolls every side effect and the claim
 * back together.
 */

import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 6 });

type Fixture = {
  binId: string;
  draftCatalogId: string;
  finishedGoodId: string;
  packagedCatalogId: string;
  squareLocationId: string;
};

type AtomicResult = {
  kind: "processed" | "duplicate" | "in_flight" | "manual_reconcile";
  items_failed?: number;
  items_synced?: number;
  log_id?: string;
};

afterAll(async () => {
  await pool.end();
});

async function withTransaction<T>(
  fn: (db: PoolClient) => Promise<T>,
): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    return await fn(db);
  } finally {
    await db.query("ROLLBACK").catch(() => undefined);
    db.release();
  }
}

async function createFixture(db: PoolClient, suffix: string): Promise<Fixture> {
  const squareLocationId = `sq-location-${suffix}`;
  const packagedCatalogId = `sq-packaged-${suffix}`;
  const draftCatalogId = `sq-draft-${suffix}`;

  const { rows: locations } = await db.query<{ id: string }>(
    "INSERT INTO locations (name) VALUES ($1) RETURNING id",
    [`Square atomic location ${suffix}`],
  );
  await db.query(
    `INSERT INTO square_locations (square_location_id, name, status)
     VALUES ($1, $2, 'ACTIVE')`,
    [squareLocationId, `Square location ${suffix}`],
  );
  const { rows: bins } = await db.query<{ id: string }>(
    `INSERT INTO bins (location_id, name, square_location_id)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [locations[0]!.id, `Taproom ${suffix}`, squareLocationId],
  );

  const { rows: containers } = await db.query<{ id: string; type: string }>(
    `INSERT INTO containers (name, type, volume_oz, volume_bbl)
     VALUES
       ($1, 'package', 12, NULL),
       ($2, 'keg', NULL, 0.5)
     RETURNING id, type`,
    [`Can ${suffix}`, `Keg ${suffix}`],
  );
  const canId = containers.find((row) => row.type === "package")!.id;
  const kegId = containers.find((row) => row.type === "keg")!.id;
  const { rows: formats } = await db.query<{ id: string; container_id: string }>(
    `INSERT INTO selling_formats (container_id, name, unit_count)
     VALUES ($1, $3, 6), ($2, $4, 1)
     RETURNING id, container_id`,
    [canId, kegId, `Six pack ${suffix}`, `Draft pour ${suffix}`],
  );
  const packagedFormatId = formats.find((row) => row.container_id === canId)!.id;
  const draftFormatId = formats.find((row) => row.container_id === kegId)!.id;
  const { rows: legacyPackageTypes } = await db.query<{ id: string }>(
    `INSERT INTO package_types (name, container_type, volume_oz, units_per_case)
     VALUES ($1, 'can', 12, 6)
     RETURNING id`,
    [`Replay-only package ${suffix}`],
  );
  const { rows: brands } = await db.query<{ id: string; name: string }>(
    `INSERT INTO brands (name) VALUES ($1), ($2) RETURNING id, name`,
    [`Packaged brand ${suffix}`, `Draft brand ${suffix}`],
  );
  const packagedBrandId = brands.find((row) => row.name.startsWith("Packaged"))!.id;
  const draftBrandId = brands.find((row) => row.name.startsWith("Draft"))!.id;

  await db.query(
    `INSERT INTO square_catalog_map (
       brand_id, selling_format_id, square_catalog_id, object_type, pour_size_oz
     ) VALUES
       ($1, $2, $3, 'ITEM_VARIATION', NULL),
       ($4, $5, $6, 'ITEM_VARIATION', 12)`,
    [
      packagedBrandId,
      packagedFormatId,
      packagedCatalogId,
      draftBrandId,
      draftFormatId,
      draftCatalogId,
    ],
  );

  const { rows: finishedGoods } = await db.query<{ id: string }>(
    `INSERT INTO finished_goods (
       brand_id, package_type_id, selling_format_id, quantity, lot_number,
       production_date
     ) VALUES ($1, $2, $3, 20, $4, CURRENT_DATE - 7)
     RETURNING id`,
    [
      packagedBrandId,
      legacyPackageTypes[0]!.id,
      packagedFormatId,
      `LOT-${suffix}`,
    ],
  );
  await db.query(
    `INSERT INTO bin_inventory (finished_good_id, bin_id, quantity)
     VALUES ($1, $2, 20)`,
    [finishedGoods[0]!.id, bins[0]!.id],
  );

  return {
    binId: bins[0]!.id,
    draftCatalogId,
    finishedGoodId: finishedGoods[0]!.id,
    packagedCatalogId,
    squareLocationId,
  };
}

function saleLines(fixture: Fixture, includeDraft = false) {
  return [
    {
      uid: "packaged-line",
      catalog_object_id: fixture.packagedCatalogId,
      quantity: "3",
      unit_price_cents: 1800,
    },
    ...(includeDraft
      ? [{
          uid: "draft-line",
          catalog_object_id: fixture.draftCatalogId,
          quantity: "2",
          unit_price_cents: 700,
        }]
      : []),
  ];
}

async function ingestSale(
  db: PoolClient,
  fixture: Fixture,
  orderId: string,
  eventId: string,
  includeDraft = false,
  lines = saleLines(fixture, includeDraft),
): Promise<AtomicResult> {
  const { rows } = await db.query<{ result: AtomicResult }>(
    `SELECT ingest_square_sale_atomic(
       $1::text, $2::text, $3::text, $4::text, $5::text,
       $6::timestamptz, $7::jsonb
     ) AS result`,
    [
      orderId,
      eventId,
      orderId,
      `payment-${orderId}`,
      fixture.squareLocationId,
      "2026-07-15T12:00:00.000Z",
      JSON.stringify(lines),
    ],
  );
  return rows[0]!.result;
}

async function ingestRefund(
  db: PoolClient,
  fixture: Fixture,
  orderId: string,
  refundId: string,
  refundAmount = 2500,
  orderTotal = 2500,
): Promise<AtomicResult> {
  const { rows } = await db.query<{ result: AtomicResult }>(
    `SELECT ingest_square_refund_atomic(
       $1::text, $2::text, $3::text, $4::text, $5::text,
       $6::timestamptz, $7::bigint, $8::bigint
     ) AS result`,
    [
      refundId,
      `event-${refundId}`,
      orderId,
      `payment-${orderId}`,
      fixture.squareLocationId,
      "2026-07-15T13:00:00.000Z",
      refundAmount,
      orderTotal,
    ],
  );
  return rows[0]!.result;
}

async function installFinalizeFailure(
  db: PoolClient,
  suffix: string,
  syncType: "sale_ingest" | "refund_ingest",
) {
  const safeSuffix = suffix.replaceAll("-", "");
  const functionName = `fail_square_finalize_${safeSuffix}`;
  const triggerName = `fail_square_finalize_${safeSuffix}`;
  await db.query(`
    CREATE FUNCTION ${functionName}() RETURNS trigger
    LANGUAGE plpgsql SET search_path = public AS $body$
    BEGIN
      IF NEW.sync_type = '${syncType}'
         AND OLD.completed_at IS NULL
         AND NEW.completed_at IS NOT NULL THEN
        RAISE EXCEPTION 'injected ${syncType} finalization failure';
      END IF;
      RETURN NEW;
    END
    $body$;
    CREATE TRIGGER ${triggerName}
      BEFORE UPDATE ON square_sync_log
      FOR EACH ROW EXECUTE FUNCTION ${functionName}();
  `);
  return { functionName, triggerName };
}

async function removeFinalizeFailure(
  db: PoolClient,
  names: { functionName: string; triggerName: string },
) {
  await db.query(`
    DROP TRIGGER ${names.triggerName} ON square_sync_log;
    DROP FUNCTION ${names.functionName}();
  `);
}

async function readEffects(db: PoolClient, fixture: Fixture, orderId: string) {
  // A pg PoolClient represents one connection; keep its queries sequential so
  // the assertions never rely on driver-side pipelining behavior.
  const bin = await db.query<{ quantity: number }>(
    "SELECT quantity FROM bin_inventory WHERE bin_id = $1 AND finished_good_id = $2",
    [fixture.binId, fixture.finishedGoodId],
  );
  const saleAllocations = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM allocations
     WHERE notes = $1 AND destination_type = 'taproom_sale'`,
    [`Square order ${orderId}`],
  );
  const reversalAllocations = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM allocations
     WHERE notes LIKE $1 AND destination_type = 'adjustment'`,
    [`Square refund % of order ${orderId}`],
  );
  const draftRows = await db.query<{ voided_at: Date | null }>(
    "SELECT voided_at FROM square_draft_sales WHERE square_order_id = $1",
    [orderId],
  );
  const claims = await db.query<{ completed_at: Date | null; sync_type: string }>(
    `SELECT sync_type, completed_at FROM square_sync_log
     WHERE square_payment_id = $1 OR details->>'order_id' = $1
     ORDER BY sync_type`,
    [orderId],
  );
  return {
    binQuantity: bin.rows[0]!.quantity,
    claimRows: claims.rows,
    draftRows: draftRows.rows,
    reversalCount: Number(reversalAllocations.rows[0]!.count),
    saleCount: Number(saleAllocations.rows[0]!.count),
  };
}

async function deleteCommittedFixture(
  db: PoolClient,
  fixture: Fixture,
  suffix: string,
  orderId: string,
) {
  // This helper runs only against the disposable integration database. The
  // production audit trigger correctly forbids deleting completed allocations;
  // disable triggers locally so committed concurrency fixtures can be removed.
  await db.query("SET LOCAL session_replication_role = replica");
  await db.query(
    `DELETE FROM square_sync_log
     WHERE square_payment_id = $1 OR details->>'order_id' = $1`,
    [orderId],
  );
  await db.query("DELETE FROM allocations WHERE notes = $1", [`Square order ${orderId}`]);
  await db.query("DELETE FROM allocations WHERE notes LIKE $1", [
    `Square refund % of order ${orderId}`,
  ]);
  await db.query("DELETE FROM square_draft_sales WHERE square_order_id = $1", [orderId]);
  await db.query("DELETE FROM bin_inventory WHERE bin_id = $1", [fixture.binId]);
  await db.query(
    "DELETE FROM square_catalog_map WHERE square_catalog_id = ANY($1::text[])",
    [[fixture.packagedCatalogId, fixture.draftCatalogId]],
  );
  await db.query("DELETE FROM finished_goods WHERE id = $1", [fixture.finishedGoodId]);
  await db.query("DELETE FROM bins WHERE id = $1", [fixture.binId]);
  await db.query("DELETE FROM square_locations WHERE square_location_id = $1", [fixture.squareLocationId]);
  await db.query("DELETE FROM selling_formats WHERE name = ANY($1::text[])", [
    [`Six pack ${suffix}`, `Draft pour ${suffix}`],
  ]);
  await db.query("DELETE FROM containers WHERE name = ANY($1::text[])", [
    [`Can ${suffix}`, `Keg ${suffix}`],
  ]);
  await db.query("DELETE FROM package_types WHERE name = $1", [`Replay-only package ${suffix}`]);
  await db.query("DELETE FROM brands WHERE name = ANY($1::text[])", [
    [`Packaged brand ${suffix}`, `Draft brand ${suffix}`],
  ]);
  await db.query("DELETE FROM locations WHERE name = $1", [`Square atomic location ${suffix}`]);
}

describe("atomic Square sale ingestion", () => {
  it("serializes concurrent deliveries so only one debits inventory", async () => {
    const suffix = randomUUID();
    const orderId = `concurrent-order-${suffix}`;
    const setup = await pool.connect();
    let fixture: Fixture | undefined;

    try {
      await setup.query("BEGIN");
      fixture = await createFixture(setup, suffix);
      await setup.query("COMMIT");

      const first = await pool.connect();
      const second = await pool.connect();
      try {
        const results = await Promise.all([
          ingestSale(first, fixture, orderId, `event-a-${suffix}`),
          ingestSale(second, fixture, orderId, `event-b-${suffix}`),
        ]);
        expect(results.map((result) => result.kind).sort()).toEqual([
          "duplicate",
          "processed",
        ]);
      } finally {
        first.release();
        second.release();
      }

      expect(await readEffects(setup, fixture, orderId)).toMatchObject({
        binQuantity: 17,
        saleCount: 1,
      });
    } finally {
      await setup.query("ROLLBACK").catch(() => undefined);
      try {
        if (fixture) {
          await setup.query("BEGIN");
          await deleteCommittedFixture(setup, fixture, suffix, orderId);
          await setup.query("COMMIT");
        }
      } catch (error) {
        await setup.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        setup.release();
      }
    }
  });

  it("waits for a concurrent sale before deciding whether its refund is known", async () => {
    const suffix = randomUUID();
    const orderId = `sale-refund-race-${suffix}`;
    const setup = await pool.connect();
    let fixture: Fixture | undefined;

    try {
      await setup.query("BEGIN");
      fixture = await createFixture(setup, suffix);
      await setup.query("COMMIT");

      const saleDb = await pool.connect();
      const refundDb = await pool.connect();
      try {
        await saleDb.query("BEGIN");
        await saleDb.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('square_order:' || $1, 0))",
          [orderId],
        );

        const refundPromise = ingestRefund(
          refundDb,
          fixture,
          orderId,
          `concurrent-refund-${suffix}`,
        );
        const earlyRefund = await Promise.race([
          refundPromise.then(() => "settled" as const),
          new Promise<"waiting">((resolve) => setTimeout(() => resolve("waiting"), 25)),
        ]);
        expect(earlyRefund).toBe("waiting");

        const sale = await ingestSale(
          saleDb,
          fixture,
          orderId,
          `concurrent-sale-${suffix}`,
          true,
        );
        expect(sale.kind).toBe("processed");
        await saleDb.query("COMMIT");

        const refund = await refundPromise;
        expect(refund.kind).toBe("processed");
      } finally {
        await saleDb.query("ROLLBACK").catch(() => undefined);
        saleDb.release();
        refundDb.release();
      }

      expect(await readEffects(setup, fixture, orderId)).toMatchObject({
        binQuantity: 20,
        draftRows: [{ voided_at: expect.any(Date) }],
        reversalCount: 1,
        saleCount: 1,
      });
    } finally {
      await setup.query("ROLLBACK").catch(() => undefined);
      try {
        if (fixture) {
          await setup.query("BEGIN");
          await deleteCommittedFixture(setup, fixture, suffix, orderId);
          await setup.query("COMMIT");
        }
      } catch (error) {
        await setup.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        setup.release();
      }
    }
  });

  it("rolls claim, allocation, bin debit, and draft row back when finalization fails", async () => {
    await withTransaction(async (db) => {
      const suffix = randomUUID();
      const fixture = await createFixture(db, suffix);
      const orderId = `order-${suffix}`;
      const failure = await installFinalizeFailure(db, suffix, "sale_ingest");

      await db.query("SAVEPOINT failed_sale");
      await expect(
        ingestSale(db, fixture, orderId, `event-sale-${suffix}`, true),
      ).rejects.toThrow("injected sale_ingest finalization failure");
      await db.query("ROLLBACK TO SAVEPOINT failed_sale");

      expect(await readEffects(db, fixture, orderId)).toEqual({
        binQuantity: 20,
        claimRows: [],
        draftRows: [],
        reversalCount: 0,
        saleCount: 0,
      });

      await removeFinalizeFailure(db, failure);
      const result = await ingestSale(
        db,
        fixture,
        orderId,
        `event-sale-retry-${suffix}`,
        true,
      );
      expect(result).toMatchObject({ kind: "processed", items_synced: 2, items_failed: 0 });
      expect(await readEffects(db, fixture, orderId)).toMatchObject({
        binQuantity: 17,
        saleCount: 1,
        reversalCount: 0,
        draftRows: [{ voided_at: null }],
      });

      const duplicate = await ingestSale(
        db,
        fixture,
        orderId,
        `event-sale-duplicate-${suffix}`,
        true,
      );
      expect(duplicate).toEqual({ kind: "duplicate" });
      expect(await readEffects(db, fixture, orderId)).toMatchObject({
        binQuantity: 17,
        saleCount: 1,
        draftRows: [{ voided_at: null }],
      });
    });
  });

  it("refuses to replay a stale pre-atomic claim with unknowable side effects", async () => {
    await withTransaction(async (db) => {
      const suffix = randomUUID();
      const fixture = await createFixture(db, suffix);
      const orderId = `legacy-order-${suffix}`;
      await db.query(
        `INSERT INTO square_sync_log (
           sync_type, event_id, square_payment_id, started_at, details
         ) VALUES ('sale_ingest', $1, $2, now() - interval '20 minutes', $3::jsonb)`,
        [`legacy-event-${suffix}`, orderId, JSON.stringify({ order_id: orderId })],
      );

      const result = await ingestSale(
        db,
        fixture,
        orderId,
        `event-after-crash-${suffix}`,
      );
      expect(result.kind).toBe("manual_reconcile");

      const effects = await readEffects(db, fixture, orderId);
      expect(effects).toMatchObject({ binQuantity: 20, saleCount: 0 });
      expect(effects.claimRows).toEqual([
        expect.objectContaining({ sync_type: "sale_ingest", completed_at: expect.any(Date) }),
      ]);
    });
  });

  it("durably records a deterministic line error without mutating inventory", async () => {
    await withTransaction(async (db) => {
      const suffix = randomUUID();
      const fixture = await createFixture(db, suffix);
      const orderId = `invalid-line-order-${suffix}`;
      const invalidLines = [{
        uid: "fractional-line",
        catalog_object_id: fixture.packagedCatalogId,
        quantity: "2.5",
        unit_price_cents: 1800,
      }];

      const result = await ingestSale(
        db,
        fixture,
        orderId,
        `invalid-line-event-${suffix}`,
        false,
        invalidLines,
      );
      expect(result).toMatchObject({ kind: "processed", items_failed: 1, items_synced: 0 });
      expect(await readEffects(db, fixture, orderId)).toMatchObject({
        binQuantity: 20,
        saleCount: 0,
        claimRows: [
          expect.objectContaining({
            completed_at: expect.any(Date),
            sync_type: "sale_ingest",
          }),
        ],
      });

      const duplicate = await ingestSale(
        db,
        fixture,
        orderId,
        `invalid-line-retry-${suffix}`,
        false,
        invalidLines,
      );
      expect(duplicate.kind).toBe("duplicate");
      expect((await readEffects(db, fixture, orderId)).binQuantity).toBe(20);
    });
  });
});

describe("atomic Square refund ingestion", () => {
  it("applies a partial refund once and deduplicates its retry", async () => {
    await withTransaction(async (db) => {
      const suffix = randomUUID();
      const fixture = await createFixture(db, suffix);
      const orderId = `partial-refund-order-${suffix}`;
      const refundId = `partial-refund-${suffix}`;
      await ingestSale(db, fixture, orderId, `partial-sale-${suffix}`);

      const result = await ingestRefund(db, fixture, orderId, refundId, 1250, 2500);
      expect(result).toMatchObject({ kind: "processed", items_failed: 0 });
      expect(await readEffects(db, fixture, orderId)).toMatchObject({
        binQuantity: 18,
        reversalCount: 1,
        saleCount: 1,
      });
      const { rows } = await db.query<{ quantity: number }>(
        `SELECT quantity::integer AS quantity FROM allocations
         WHERE notes = $1 AND destination_type = 'adjustment'`,
        [`Square refund ${refundId} of order ${orderId}`],
      );
      expect(rows).toEqual([{ quantity: -1 }]);

      const duplicate = await ingestRefund(db, fixture, orderId, refundId, 1250, 2500);
      expect(duplicate.kind).toBe("duplicate");
      expect(await readEffects(db, fixture, orderId)).toMatchObject({
        binQuantity: 18,
        reversalCount: 1,
      });
    });
  });

  it("rolls reversal, bin credit, draft void, and refund claim back together", async () => {
    await withTransaction(async (db) => {
      const suffix = randomUUID();
      const fixture = await createFixture(db, suffix);
      const orderId = `refund-order-${suffix}`;
      await ingestSale(db, fixture, orderId, `event-sale-${suffix}`, true);
      const failure = await installFinalizeFailure(db, suffix, "refund_ingest");

      await db.query("SAVEPOINT failed_refund");
      await expect(
        ingestRefund(db, fixture, orderId, `refund-${suffix}`),
      ).rejects.toThrow("injected refund_ingest finalization failure");
      await db.query("ROLLBACK TO SAVEPOINT failed_refund");

      expect(await readEffects(db, fixture, orderId)).toMatchObject({
        binQuantity: 17,
        saleCount: 1,
        reversalCount: 0,
        draftRows: [{ voided_at: null }],
      });

      await removeFinalizeFailure(db, failure);
      const result = await ingestRefund(db, fixture, orderId, `refund-retry-${suffix}`);
      expect(result).toMatchObject({ kind: "processed", items_failed: 0 });
      expect(await readEffects(db, fixture, orderId)).toMatchObject({
        binQuantity: 20,
        saleCount: 1,
        reversalCount: 1,
        draftRows: [{ voided_at: expect.any(Date) }],
      });

      const duplicate = await ingestRefund(db, fixture, orderId, `refund-retry-${suffix}`);
      expect(duplicate).toEqual({ kind: "duplicate" });
      expect(await readEffects(db, fixture, orderId)).toMatchObject({
        binQuantity: 20,
        reversalCount: 1,
      });
    });
  });
});
