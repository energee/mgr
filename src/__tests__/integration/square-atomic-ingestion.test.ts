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
  kind:
    | "processed"
    | "duplicate"
    | "in_flight"
    | "manual_reconcile"
    | "sale_missing";
  items_failed?: number;
  items_synced?: number;
  log_id?: string;
  retry_after_seconds?: number;
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

/**
 * Replays what POST /api/square/reconcile-draft-sales writes for one staged
 * keg pour (#606): a keg-format finished-good lot, a completed
 * finished_good -> taproom_sale allocation in FRACTIONAL kegs carrying the
 * reconciler's descriptive note plus its stable `square_draft_sale:<id>`
 * idempotency key, and the `reconciled_at` stamp. The route itself is not
 * importable here (it is a Next handler over PostgREST), so the exact payload
 * from reconcile-draft-sales/route.ts is reproduced instead.
 */
async function reconcileDraftSale(
  db: PoolClient,
  orderId: string,
  suffix: string,
) {
  const { rows: drafts } = await db.query<{
    id: string;
    brand_id: string;
    selling_format_id: string;
    volume_oz: string;
    sold_at: Date;
  }>(
    `SELECT id, brand_id, selling_format_id, volume_oz, sold_at
     FROM square_draft_sales WHERE square_order_id = $1`,
    [orderId],
  );
  const draft = drafts[0]!;

  const { rows: lots } = await db.query<{ id: string }>(
    `INSERT INTO finished_goods (
       brand_id, selling_format_id, quantity, lot_number, production_date
     ) VALUES ($1, $2, 1, $3, CURRENT_DATE - 3)
     RETURNING id`,
    [draft.brand_id, draft.selling_format_id, `KEG-LOT-${suffix}`],
  );
  const kegLotId = lots[0]!.id;

  // The fixture's keg container is 0.5 bbl; 1 bbl = 3968 oz.
  const OZ_PER_BBL = 3968;
  const oz = Number(draft.volume_oz);
  const kegs = Number((oz / (0.5 * OZ_PER_BBL)).toFixed(4));
  const bbl = Number((oz / OZ_PER_BBL).toFixed(4));

  await db.query(
    `INSERT INTO allocations (
       source_type, source_id, destination_type, destination_id, quantity,
       volume_bbl, reason_code, status, completed_at, notes, idempotency_key
     ) VALUES (
       'finished_good', $1, 'taproom_sale', NULL, $2, $3, 'other', 'completed',
       $4, $5, $6
     )`,
    [
      kegLotId,
      kegs,
      bbl,
      draft.sold_at,
      `Square draft sale reconciliation (order ${orderId})`,
      `square_draft_sale:${draft.id}`,
    ],
  );
  await db.query("UPDATE square_draft_sales SET reconciled_at = now() WHERE id = $1", [
    draft.id,
  ]);

  return { bbl, draftId: draft.id, kegLotId, kegs };
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

  it("catches up cumulative rounding across sequential partial refunds", async () => {
    await withTransaction(async (db) => {
      const suffix = randomUUID();
      const fixture = await createFixture(db, suffix);
      const orderId = `sequential-refund-order-${suffix}`;
      await ingestSale(db, fixture, orderId, `sequential-sale-${suffix}`, true);

      const first = await ingestRefund(
        db,
        fixture,
        orderId,
        `sequential-refund-a-${suffix}`,
        1250,
        2500,
      );
      const second = await ingestRefund(
        db,
        fixture,
        orderId,
        `sequential-refund-b-${suffix}`,
        1250,
        2500,
      );

      expect(first).toMatchObject({ kind: "processed", items_failed: 0 });
      expect(second).toMatchObject({ kind: "processed", items_failed: 0 });
      expect(await readEffects(db, fixture, orderId)).toMatchObject({
        binQuantity: 20,
        draftRows: [{ voided_at: expect.any(Date) }],
        reversalCount: 2,
        saleCount: 1,
      });

      const { rows } = await db.query<{ quantity: number }>(
        `SELECT quantity::integer AS quantity
         FROM allocations
         WHERE notes LIKE $1 AND destination_type = 'adjustment'
         ORDER BY completed_at, notes`,
        [`Square refund % of order ${orderId}`],
      );
      expect(rows).toEqual([{ quantity: -1 }, { quantity: -2 }]);

      const { rows: logs } = await db.query<{ details: Record<string, unknown> }>(
        `SELECT details FROM square_sync_log WHERE square_payment_id = $1`,
        [`sequential-refund-b-${suffix}`],
      );
      expect(logs[0]!.details).toMatchObject({
        atomic_version: 2,
        cumulative_full: true,
        cumulative_refund_amount: 2500,
        prior_refund_amount: 1250,
      });
    });
  });

  it("quarantines an order-total-mismatch refund and still sizes later consistent refunds (#547)", async () => {
    await withTransaction(async (db) => {
      const suffix = randomUUID();
      const fixture = await createFixture(db, suffix);
      const orderId = `mismatch-order-${suffix}`;
      await ingestSale(db, fixture, orderId, `mismatch-sale-${suffix}`);

      const first = await ingestRefund(
        db,
        fixture,
        orderId,
        `mismatch-refund-a-${suffix}`,
        1250,
        2500,
      );
      expect(first).toMatchObject({ kind: "processed", items_failed: 0 });
      expect(await readEffects(db, fixture, orderId)).toMatchObject({
        binQuantity: 18,
        reversalCount: 1,
      });

      // A refund event reporting a different order total than the completed
      // refund history cannot be sized safely. It must fail durably without
      // touching inventory.
      const poisoned = await ingestRefund(
        db,
        fixture,
        orderId,
        `mismatch-refund-b-${suffix}`,
        625,
        1000,
      );
      expect(poisoned).toMatchObject({
        kind: "processed",
        items_failed: 1,
        items_synced: 0,
      });
      expect(await readEffects(db, fixture, orderId)).toMatchObject({
        binQuantity: 18,
        reversalCount: 1,
      });

      // The failed log is quarantined as a manual-reconcile record so it never
      // participates in future sizing (neither its divergent order total nor
      // its never-applied refund amount).
      const { rows: poisonedLogs } = await db.query<{
        details: Record<string, unknown>;
      }>(
        "SELECT details FROM square_sync_log WHERE square_payment_id = $1",
        [`mismatch-refund-b-${suffix}`],
      );
      expect(poisonedLogs[0]!.details).toMatchObject({
        manual_reconcile: true,
        errors: [expect.objectContaining({ item: "sizing" })],
      });

      // The mismatched refund itself stays sealed; its inventory effect is a
      // manual reversal from the sync log, exactly as the recorded error says.
      const sealed = await ingestRefund(
        db,
        fixture,
        orderId,
        `mismatch-refund-b-${suffix}`,
        1250,
        2500,
      );
      expect(sealed.kind).toBe("duplicate");

      // Regression (#547): before 00267 the failed log's divergent order total
      // re-triggered the mismatch branch forever, permanently blocking every
      // later automatic reversal for the order. A later refund whose total is
      // consistent with the effective history must size automatically.
      const recovered = await ingestRefund(
        db,
        fixture,
        orderId,
        `mismatch-refund-c-${suffix}`,
        1250,
        2500,
      );
      expect(recovered).toMatchObject({ kind: "processed", items_failed: 0 });
      expect(await readEffects(db, fixture, orderId)).toMatchObject({
        binQuantity: 20,
        reversalCount: 2,
        saleCount: 1,
      });

      // Sizing after recovery counts only effective refunds: the quarantined
      // 625 never inflates prior_refund_amount or the cumulative target.
      const { rows: recoveredLogs } = await db.query<{
        details: Record<string, unknown>;
      }>(
        "SELECT details FROM square_sync_log WHERE square_payment_id = $1",
        [`mismatch-refund-c-${suffix}`],
      );
      expect(recoveredLogs[0]!.details).toMatchObject({
        prior_refund_amount: 1250,
        cumulative_refund_amount: 2500,
        cumulative_full: true,
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

  it("ignores pre-existing failed sizing logs in the cumulative ledger (#547)", async () => {
    await withTransaction(async (db) => {
      const suffix = randomUUID();
      const fixture = await createFixture(db, suffix);
      const orderId = `poisoned-order-${suffix}`;
      const legitRefund = `legit-refund-${suffix}`;
      await ingestSale(db, fixture, orderId, `poisoned-sale-${suffix}`);
      expect((await readEffects(db, fixture, orderId)).binQuantity).toBe(17);

      // A failed sizing log as sealed by the pre-00268 function: completed,
      // items_failed = 1, divergent order_total, NO manual_reconcile flag.
      // Covers both pre-00267 v2 mismatch rows and v1-era (00257) failed logs —
      // recovery requires no backfill because items_failed alone excludes them
      // from the cumulative ledger. 00267's NOT-manual_reconcile filter alone
      // would still count this row and refuse the legit refund below.
      await db.query(
        `INSERT INTO square_sync_log (
           sync_type, event_id, square_payment_id, items_synced, items_failed,
           completed_at, details
         ) VALUES ('refund_ingest', $1, $2, 0, 1, now(), $3::jsonb)`,
        [
          `poison-event-${suffix}`,
          `poison-refund-${suffix}`,
          JSON.stringify({
            atomic_version: 2,
            order_id: orderId,
            refund_amount: 625,
            order_total: 1300,
            errors: [{
              item: "sizing",
              error: "Prior refunds for this Square order recorded a different order total; reverse manually from the sync log",
            }],
          }),
        ],
      );

      const result = await ingestRefund(db, fixture, orderId, legitRefund, 1250, 2500);
      expect(result).toMatchObject({ kind: "processed", items_failed: 0 });
      expect(await readEffects(db, fixture, orderId)).toMatchObject({
        binQuantity: 18,
        reversalCount: 1,
      });
      const { rows: logs } = await db.query<{ details: Record<string, unknown> }>(
        "SELECT details FROM square_sync_log WHERE square_payment_id = $1",
        [legitRefund],
      );
      // Neither the poison row's 1300 total counted as a mismatch nor its 625
      // counted as prior refunded money.
      expect(logs[0]!.details).toMatchObject({ prior_refund_amount: 0 });
    });
  });
});

describe("refund of an already-reconciled draft keg pour (#606)", () => {
  it("reverses the fractional keg draw and credits no bin", async () => {
    await withTransaction(async (db) => {
      const suffix = randomUUID();
      const fixture = await createFixture(db, suffix);
      const orderId = `reconciled-draft-order-${suffix}`;
      const refundId = `reconciled-draft-refund-${suffix}`;
      await ingestSale(db, fixture, orderId, `reconciled-draft-sale-${suffix}`, true);

      // The operator reconciles the staged pour into a TTB removal BEFORE the
      // refund arrives — the ordering the reversal predicate never covered.
      const recon = await reconcileDraftSale(db, orderId, suffix);
      expect(recon.kegs).toBeGreaterThan(0);
      expect(recon.kegs).toBeLessThan(1);

      const result = await ingestRefund(db, fixture, orderId, refundId, 2500, 2500);
      expect(result).toMatchObject({ kind: "processed", items_failed: 0 });

      // A negative finished_good -> adjustment row neutralizes the removal.
      const { rows: reversals } = await db.query<{
        quantity: string;
        volume_bbl: string;
      }>(
        `SELECT quantity::text AS quantity, volume_bbl::text AS volume_bbl
         FROM allocations
         WHERE source_id = $1
           AND destination_type = 'adjustment'
           AND reason_code = 'refund'`,
        [recon.kegLotId],
      );
      expect(reversals).toEqual([
        {
          quantity: (-recon.kegs).toFixed(4),
          volume_bbl: (-recon.bbl).toFixed(4),
        },
      ]);

      // The keg sale never debited a bin, so the reversal must not credit one.
      const { rows: kegBinRows } = await db.query(
        "SELECT quantity FROM bin_inventory WHERE finished_good_id = $1",
        [recon.kegLotId],
      );
      expect(kegBinRows).toEqual([]);

      // ...and no "unmapped POS bin" warning is emitted for the draft row.
      const { rows: logs } = await db.query<{ details: Record<string, unknown> }>(
        "SELECT details FROM square_sync_log WHERE square_payment_id = $1",
        [refundId],
      );
      expect(JSON.stringify(logs[0]!.details)).not.toContain("no bin credited");

      // The packaged leg still reverses exactly as before (#477 unchanged).
      expect(await readEffects(db, fixture, orderId)).toMatchObject({
        binQuantity: 20,
        draftRows: [{ voided_at: expect.any(Date) }],
        saleCount: 1,
      });
    });
  });

  it("reverses a reconciled pour proportionally across sequential partial refunds", async () => {
    await withTransaction(async (db) => {
      const suffix = randomUUID();
      const fixture = await createFixture(db, suffix);
      const orderId = `partial-draft-order-${suffix}`;
      await ingestSale(db, fixture, orderId, `partial-draft-sale-${suffix}`, true);
      const recon = await reconcileDraftSale(db, orderId, suffix);

      const first = await ingestRefund(
        db,
        fixture,
        orderId,
        `partial-draft-refund-a-${suffix}`,
        1250,
        2500,
      );
      const second = await ingestRefund(
        db,
        fixture,
        orderId,
        `partial-draft-refund-b-${suffix}`,
        1250,
        2500,
      );
      expect(first).toMatchObject({ kind: "processed", items_failed: 0 });
      expect(second).toMatchObject({ kind: "processed", items_failed: 0 });

      // Two events, and together they reverse the original draw exactly once —
      // no double credit (the #477 property, now on the fractional path).
      const { rows } = await db.query<{ total: string; n: string }>(
        `SELECT COALESCE(SUM(quantity), 0)::text AS total, count(*)::text AS n
         FROM allocations
         WHERE source_id = $1
           AND destination_type = 'adjustment'
           AND reason_code = 'refund'`,
        [recon.kegLotId],
      );
      expect(rows[0]!.n).toBe("2");
      expect(Number(rows[0]!.total)).toBeCloseTo(-recon.kegs, 4);
    });
  });
});

describe("refund delivered before its sale (#607)", () => {
  it("records a durable deferred claim, asks for a retry, and applies on redelivery", async () => {
    await withTransaction(async (db) => {
      const suffix = randomUUID();
      const fixture = await createFixture(db, suffix);
      const orderId = `early-refund-order-${suffix}`;
      const refundId = `early-refund-${suffix}`;

      const deferred = await ingestRefund(db, fixture, orderId, refundId, 2500, 2500);
      expect(deferred).toMatchObject({ kind: "sale_missing" });
      expect(deferred.retry_after_seconds).toBeGreaterThan(0);

      const { rows: claims } = await db.query<{
        items_failed: number;
        state: string | null;
        completed_at: Date | null;
      }>(
        `SELECT items_failed, completed_at, details->>'state' AS state
         FROM square_sync_log WHERE square_payment_id = $1`,
        [refundId],
      );
      expect(claims).toHaveLength(1);
      expect(claims[0]).toMatchObject({ items_failed: 1, state: "sale_missing" });

      // A second delivery while the sale is still missing stays deferred and
      // does not accumulate claim rows.
      const stillDeferred = await ingestRefund(db, fixture, orderId, refundId, 2500, 2500);
      expect(stillDeferred).toMatchObject({ kind: "sale_missing" });

      // The payment retry finally lands...
      await ingestSale(db, fixture, orderId, `early-sale-${suffix}`);
      expect((await readEffects(db, fixture, orderId)).binQuantity).toBe(17);

      // ...and Square's next refund delivery applies the reversal.
      const applied = await ingestRefund(db, fixture, orderId, refundId, 2500, 2500);
      expect(applied).toMatchObject({ kind: "processed", items_failed: 0 });
      expect(await readEffects(db, fixture, orderId)).toMatchObject({
        binQuantity: 20,
        reversalCount: 1,
        saleCount: 1,
      });

      const { rows: afterRows } = await db.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM square_sync_log WHERE square_payment_id = $1",
        [refundId],
      );
      expect(afterRows[0]!.n).toBe("1");

      // One more delivery must not double-reverse.
      const replay = await ingestRefund(db, fixture, orderId, refundId, 2500, 2500);
      expect(replay.kind).toBe("duplicate");
      expect(await readEffects(db, fixture, orderId)).toMatchObject({
        binQuantity: 20,
        reversalCount: 1,
      });
    });
  });
});
