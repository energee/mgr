/**
 * TTB loss reconciliation, end to end against real Postgres (issue #437,
 * acceptance criteria 5 and 6).
 *
 * `ttb-removals-batch-losses.test.ts` pins `get_ttb_removals_summary` against
 * hand-written allocation rows. This suite closes the other half: it drives the
 * *writers* — `transition_entity_atomic` (00256) completing a packaging session
 * and then a batch — and asserts the loss they book actually lands on Form
 * 5130.9, that the same barrel is never reported twice, and that an injected
 * failure anywhere in the completion leaves no partial ledger behind.
 *
 * The reconciliation arm is the one the audit called TS-side-only: the
 * unattributed-remainder loss in 00256:206-218 fires with no user opt-in on
 * every batches -> completed transition, and nothing exercised it through the
 * report until now.
 *
 * ## The non-overlap invariant, and exactly how far it is pinned
 *
 * 00274 admits batch-sourced (cellar) removals onto the report while excluding
 * batch -> finished_good / transfer / batch rows, because packaged volume
 * already leaves the cellar through the packaging term. The two halves must
 * therefore partition, not overlap: for a batch whose entire baseline volume is
 * accounted for, the removals reported across ALL tax classes must sum to the
 * baseline exactly once. `sums every removal across the report exactly once`
 * pins that. PR #685 dropped cellar removals from a total; this is the test
 * that catches that class of mistake.
 *
 * Be precise about what that total is and is not sensitive to — it is a
 * one-sided regression test, and the tests here are laid out so that each
 * failure mode has an owner:
 *
 *  - Dropping the cellar line from a total makes the grand total 8.50 instead
 *    of 10.00. Caught by `sums every removal across the report exactly once`.
 *  - Misfiling a batch-sourced removal into a packaged-beer class — deleting
 *    00274's `WHEN a.source_type = 'batch' THEN 'cellar'` arm sends it to
 *    'bottled', because get_ttb_tax_class(NULL) falls through there — leaves
 *    the grand total at 10.00 and is invisible to it. Caught instead by the
 *    per-class assertions in the two tests above it (`delta.cellar` /
 *    `delta.bottled` / `delta.keg`).
 *  - Removing the `AND NOT (source_type = 'batch' AND destination_type IN
 *    (...))` exclusion changes NO reported number today, so no numeric
 *    assertion in this file can be sensitive to it. 00274's own header says as
 *    much ("the exclusion is currently a no-op on the numbers"): none of the
 *    removals SUM arms names 'finished_good', 'transfer' or 'batch', so those
 *    rows contribute 0 whether the CTE admits them or not. That clause is a
 *    forward guard, and `keeps internal batch movements out of the removals
 *    CTE` is what holds it in place.
 *
 * ## Period keying
 *
 * `get_ttb_removals_summary` buckets on COALESCE(completed_at, created_at), and
 * the RPC stamps NOW(). NOW() is the *transaction* timestamp, so deriving the
 * reporting year/month from `now()` inside the same transaction is exact even
 * across a month boundary. Numbers are asserted as deltas against a baseline
 * read taken at the top of the same transaction, so pre-existing rows in the
 * database cannot influence the result.
 *
 * Those two reads run under REPEATABLE READ, which is load-bearing rather than
 * decorative. The summary functions aggregate the whole allocations table with
 * no way to scope them to one fixture, and two of the sibling suites
 * (square-atomic-ingestion, atomic-yeast-pitch) genuinely COMMIT rows mid-run.
 * `fileParallelism: false` keeps those suites out of *this* run's way but
 * guarantees nothing about a second session, another checkout or a dev server
 * on the same database — a Square taproom sale committed between the
 * baseline and the final read lands in the same month and the same tax class as
 * this fixture's beer, and under READ COMMITTED it would show up in the delta.
 * One snapshot for the whole transaction makes the delta exactly this test's
 * own contribution. (Observed, not hypothetical: a stray 0.0544 bbl of taxpaid
 * domestic removals failed `sums every removal across the report exactly once`
 * before this was tightened.)
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

/** Deterministic UUID namespace for this suite: issue 0437, sub-range 0003. */
function uid(n: number): string {
  return `00000000-0000-0000-0437-0003${String(n).padStart(8, "0")}`;
}

afterAll(async () => {
  await pool.end();
});

/** One removals row per tax class, as numbers. */
type Removals = {
  taxpaid_domestic_bbl: number;
  taxpaid_export_bbl: number;
  tax_free_samples_bbl: number;
  losses_bbl: number;
  destroyed_bbl: number;
  adjustments_bbl: number;
};

const ZERO_REMOVALS: Removals = {
  taxpaid_domestic_bbl: 0,
  taxpaid_export_bbl: 0,
  tax_free_samples_bbl: 0,
  losses_bbl: 0,
  destroyed_bbl: 0,
  adjustments_bbl: 0,
};

/**
 * Opens this suite's transaction with bounded lock waits.
 *
 * `unwinds the loss, the vessel release, and the ingredient allocations
 * together` issues CREATE TRIGGER on `allocations`, which takes ACCESS
 * EXCLUSIVE on a table every sibling suite touches and holds it until this
 * transaction ends. Without a bound, contention with a concurrently-running
 * suite degrades into an opaque `Test timed out in 15000ms` naming nothing;
 * with one, Postgres raises `canceling statement due to lock timeout` and says
 * which statement. Both bounds sit under vitest's 15s testTimeout so the
 * database error is what surfaces. Same rationale as
 * inventory-guard-concurrency.test.ts's `beginBounded`.
 */
async function beginBounded(client: PoolClient): Promise<void> {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query("SET LOCAL statement_timeout = '10s'");
}

/** The reporting period NOW() falls in, read from the open transaction. */
async function reportingPeriod(client: PoolClient) {
  const { rows } = await client.query<{ y: number; m: number }>(
    `SELECT EXTRACT(YEAR FROM now())::int AS y, EXTRACT(MONTH FROM now())::int AS m`
  );
  return rows[0];
}

async function readRemovals(
  client: PoolClient,
  y: number,
  m: number
): Promise<Record<string, Removals>> {
  const { rows } = await client.query<Record<string, string>>(
    `SELECT * FROM get_ttb_removals_summary($1, $2)`,
    [y, m]
  );
  const out: Record<string, Removals> = {};
  for (const row of rows) {
    out[row.ttb_tax_class] = {
      taxpaid_domestic_bbl: Number(row.taxpaid_domestic_bbl),
      taxpaid_export_bbl: Number(row.taxpaid_export_bbl),
      tax_free_samples_bbl: Number(row.tax_free_samples_bbl),
      losses_bbl: Number(row.losses_bbl),
      destroyed_bbl: Number(row.destroyed_bbl),
      adjustments_bbl: Number(row.adjustments_bbl),
    };
  }
  return out;
}

/**
 * Per-class, per-line difference between two removals reads, rounded to 4dp.
 *
 * Keys are the UNION of both reads, not just the later one: a class that
 * disappears between the baseline and the final read has to surface as a
 * negative delta rather than being silently dropped. That cannot happen while
 * `get_ttb_removals_summary` returns a fixed VALUES list, but every numeric
 * assertion in this suite is built on this helper, so it must not depend on
 * that staying true.
 */
function removalsDelta(
  before: Record<string, Removals>,
  after: Record<string, Removals>
): Record<string, Removals> {
  const out: Record<string, Removals> = {};
  for (const taxClass of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const b = before[taxClass] ?? ZERO_REMOVALS;
    const a = after[taxClass] ?? ZERO_REMOVALS;
    out[taxClass] = Object.fromEntries(
      (Object.keys(ZERO_REMOVALS) as (keyof Removals)[]).map((k) => [
        k,
        Number((a[k] - b[k]).toFixed(4)),
      ])
    ) as unknown as Removals;
  }
  return out;
}

type Fixture = {
  batchId: string;
  vesselId: string;
  sessionId: string;
  lineId: string;
  lotId: string;
  ingredientAllocId: string;
  formatId: string;
  brandId: string;
};

/**
 * Seeds one 10.00 bbl batch, in a vessel, with an in_progress packaging session
 * that will package 17 half-barrel-equivalent units (8.50 bbl), a 0.25 bbl quality sample
 * already taken, and one planned ingredient allocation.
 *
 * Completion arithmetic (00256): baseline 10.00 - packaged 8.50 - attributed
 * 0.25 = 1.25 bbl unattributed, which clears GREATEST(0.05, 0.005 * 10.00) and
 * is booked as a `reconciliation` loss.
 */
async function seedBatchFixture(client: PoolClient, base: number): Promise<Fixture> {
  const brandId = uid(base + 1);
  const containerId = uid(base + 2);
  const formatId = uid(base + 3);
  const batchId = uid(base + 4);
  const vesselId = uid(base + 5);
  const brewLogId = uid(base + 6);
  const sessionId = uid(base + 7);
  const lineId = uid(base + 8);
  const itemId = uid(base + 9);
  const lotId = uid(base + 10);
  const ingredientAllocId = uid(base + 11);

  await client.query(`INSERT INTO brands (id, name) VALUES ($1, $2)`, [
    brandId,
    `TTB recon brand ${base}`,
  ]);
  // 1984 fl oz is exactly 0.5 bbl (1 bbl = 3968 fl oz). Both the packaging term
  // and the fulfillment volume read
  // COALESCE(c.volume_bbl, c.volume_oz / 3968.0), and a container volume that
  // is not a divisor of 3968 makes that quotient non-terminating — every
  // expected figure below would then be approximate and the equality
  // assertions meaningless. Type 'package' (containers_type_check allows only
  // 'package' and 'keg'; get_ttb_tax_class files it under 'bottled') also
  // keeps the line out of create_finished_goods_from_packaging's
  // `c.type = 'keg'` fill branch, which inserts a keg_transactions row without
  // a keg_type_id — NOT NULL since 00032 and never relaxed in the chain, so a
  // keg line cannot complete at all on a replayed database (issue #701). That
  // branch is not skipped silently: `keg-container packaging output (#701)`
  // below covers it, on databases where it fails AND on databases where it
  // works.
  await client.query(
    `INSERT INTO containers (id, name, type, volume_oz)
     VALUES ($1, $2, 'package', 1984)`,
    [containerId, `TTB recon 0.5 bbl package ${base}`]
  );
  await client.query(
    `INSERT INTO selling_formats (id, container_id, name, unit_count)
     VALUES ($1, $2, $3, 1)`,
    [formatId, containerId, `TTB recon single unit ${base}`]
  );
  await client.query(
    `INSERT INTO batches (id, batch_code, name, status, volume_bbl)
     VALUES ($1, $2, 'TTB reconciliation batch', 'packaging', 10)`,
    [batchId, `TTBREC-${base}`]
  );
  await client.query(
    `INSERT INTO vessels (id, name, vessel_type, capacity_bbl, status, current_batch_id)
     VALUES ($1, $2, 'fermenter', 20, 'in_use', $3)`,
    [vesselId, `TTB recon FV ${base}`, batchId]
  );

  // brew_log_batches is the baseline term of the reconciliation arithmetic.
  await client.query(
    `INSERT INTO brew_logs (id, brew_number, brew_date, status)
     VALUES ($1, $2, CURRENT_DATE, 'completed')`,
    [brewLogId, `TTBREC-BL-${base}`]
  );
  await client.query(
    `INSERT INTO brew_log_batches (brew_log_id, batch_id, volume_bbl)
     VALUES ($1, $2, 10)`,
    [brewLogId, batchId]
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
     VALUES ($1, $2, $3, $4, $5, 17, 17)`,
    [lineId, sessionId, brandId, formatId, batchId]
  );

  // A quality sample already pulled from the cellar: an attributed removal, so
  // it must reduce the reconciliation loss AND report as a cellar sample.
  await client.query(
    `INSERT INTO allocations
       (source_type, source_id, destination_type, destination_id,
        quantity, volume_bbl, status, completed_at, reason_code)
     VALUES ('batch', $1, 'sample', NULL, 0.25, 0.25, 'completed', NOW(), 'sample_quality')`,
    [batchId]
  );

  // A planned ingredient allocation, confirmed by batch completion.
  await client.query(
    `INSERT INTO inventory_items (id, category, name, unit)
     VALUES ($1, 'grain', $2, 'lb')`,
    [itemId, `TTB recon grain ${base}`]
  );
  await client.query(
    `INSERT INTO inventory_lots (id, inventory_item_id, quantity, unit)
     VALUES ($1, $2, 500, 'lb')`,
    [lotId, itemId]
  );
  await client.query(
    `INSERT INTO allocations
       (id, source_type, source_id, destination_type, destination_id, quantity, status)
     VALUES ($1, 'inventory_lot', $2, 'batch', $3, 400, 'planned')`,
    [ingredientAllocId, lotId, batchId]
  );

  return {
    batchId,
    vesselId,
    sessionId,
    lineId,
    lotId,
    ingredientAllocId,
    formatId,
    brandId,
  };
}

/** Completes the packaging session through the RPC and returns the FG row id. */
async function packageBatch(client: PoolClient, fx: Fixture): Promise<string> {
  await client.query(
    `SELECT transition_entity_atomic('packaging_sessions', $1, 'in_progress', 'completed', '{}'::jsonb)`,
    [fx.sessionId]
  );
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM finished_goods WHERE session_line_item_id = $1`,
    [fx.lineId]
  );
  expect(rows).toHaveLength(1);
  return rows[0].id;
}

describe("batch completion loss reconciliation reaches Form 5130.9", () => {
  it("books the unattributed remainder as a cellar loss on the report", async () => {
    const client = await pool.connect();
    try {
      await beginBounded(client);
      const { y, m } = await reportingPeriod(client);
      const before = await readRemovals(client, y, m);
      const fx = await seedBatchFixture(client, 100);
      await packageBatch(client, fx);

      const { rows: result } = await client.query<{
        transition_entity_atomic: {
          reconciled_loss_bbl: string | number;
          completed_allocations: number;
        };
      }>(
        `SELECT transition_entity_atomic('batches', $1, 'packaging', 'completed', '{}'::jsonb)`,
        [fx.batchId]
      );
      // 10.00 baseline - 8.50 packaged - 0.25 sampled.
      expect(Number(result[0].transition_entity_atomic.reconciled_loss_bbl)).toBe(1.25);
      expect(result[0].transition_entity_atomic.completed_allocations).toBe(1);

      // The ledger row itself: reason_code and idempotency key are what stop a
      // second completion path (archive_batch) from double-booking the loss.
      const { rows: loss } = await client.query<{
        volume_bbl: string;
        reason_code: string;
        status: string;
        idempotency_key: string;
        has_completed_at: boolean;
      }>(
        `SELECT volume_bbl, reason_code, status, idempotency_key,
                completed_at IS NOT NULL AS has_completed_at
         FROM allocations
         WHERE source_type = 'batch' AND source_id = $1 AND destination_type = 'loss'`,
        [fx.batchId]
      );
      expect(loss).toHaveLength(1);
      expect(loss[0]).toMatchObject({
        reason_code: "reconciliation",
        status: "completed",
        idempotency_key: `batch_reconcile:${fx.batchId}`,
        has_completed_at: true,
      });
      expect(Number(loss[0].volume_bbl)).toBe(1.25);

      // ...and the report picks it up in the cellar row (00274).
      const delta = removalsDelta(before, await readRemovals(client, y, m));
      expect(delta.cellar).toEqual({
        ...ZERO_REMOVALS,
        losses_bbl: 1.25,
        tax_free_samples_bbl: 0.25,
      });
      // Batch rows must not fall through get_ttb_tax_class(NULL) into the
      // bottled row: deleting 00274's `WHEN source_type = 'batch' THEN
      // 'cellar'` arm sends this fixture's loss and sample there and fails
      // the next two lines. The 8.50 bbl of packaged beer being a removal in
      // no class at all is TRUE of the data but is not pinned here — that
      // allocation carries volume_bbl NULL and a destination_type no SUM arm
      // names, so it contributes 0 to every class either way. See the file
      // header.
      expect(delta.keg).toEqual(ZERO_REMOVALS);
      expect(delta.bottled).toEqual(ZERO_REMOVALS);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("sums every removal across the report exactly once", async () => {
    const client = await pool.connect();
    try {
      await beginBounded(client);
      const { y, m } = await reportingPeriod(client);
      const before = await readRemovals(client, y, m);
      const fx = await seedBatchFixture(client, 200);
      const fgId = await packageBatch(client, fx);
      await client.query(
        `SELECT transition_entity_atomic('batches', $1, 'packaging', 'completed', '{}'::jsonb)`,
        [fx.batchId]
      );

      // Sell the whole packaged lot: a packed order with the 17 kegs reserved,
      // fulfilled through the same RPC (the allocation-fulfillment arm).
      const orderId = uid(200 + 30);
      await client.query(
        `INSERT INTO orders (id, order_number, status, order_date)
         VALUES ($1, $2, 'packed', CURRENT_DATE)`,
        [orderId, `TTBREC-ORD-200`]
      );
      await client.query(
        `INSERT INTO allocations
           (id, source_type, source_id, destination_type, destination_id, quantity, status)
         VALUES ($1, 'finished_good', $2, 'order', $3, 17, 'planned')`,
        [uid(200 + 31), fgId, orderId]
      );
      await client.query(
        `SELECT transition_entity_atomic('orders', $1, 'packed', 'fulfilled', '{}'::jsonb)`,
        [orderId]
      );

      const delta = removalsDelta(before, await readRemovals(client, y, m));

      // Cellar: only what never got packaged.
      expect(delta.cellar).toEqual({
        ...ZERO_REMOVALS,
        losses_bbl: 1.25,
        tax_free_samples_bbl: 0.25,
      });
      // Packaged beer: reported once, in its own class, when it was sold.
      expect(delta.bottled).toEqual({ ...ZERO_REMOVALS, taxpaid_domestic_bbl: 8.5 });
      expect(delta.keg).toEqual(ZERO_REMOVALS);

      // The invariant this test exists for: cellar and finished-goods removals
      // PARTITION the batch. Every one of the 10.00 brewed bbl is reported as
      // removed exactly once, so dropping the cellar row from a total leaves
      // 8.50 and fails here — the #685 mistake.
      //
      // This total is deliberately one-sided, and the per-class assertions
      // above it are what cover the other direction: a batch-sourced removal
      // misfiled into 'bottled' still totals 10.00 and would slip past this
      // line. Counting the batch -> finished_good packaging allocation as a
      // cellar removal is a third thing again — it cannot change any number at
      // all today (see the file header), so nothing here can catch it and
      // `keeps internal batch movements out of the removals CTE` covers it
      // structurally instead.
      const grandTotal = Object.values(delta).reduce(
        (sum, row) => sum + Object.values(row).reduce((a, b) => a + b, 0),
        0
      );
      expect(Number(grandTotal.toFixed(4))).toBe(10);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("keeps internal batch movements out of the removals CTE", async () => {
    const client = await pool.connect();
    try {
      await beginBounded(client);
      const { y, m } = await reportingPeriod(client);
      const before = await readRemovals(client, y, m);

      // A batch whose only ledger entries are internal movements: packaging,
      // an inter-vessel transfer, and a blend into another batch. All three
      // carry a non-null volume_bbl, unlike the packaging allocation the
      // fixture above writes, so a removals arm that summed any of these
      // destination types would move a number here.
      const batchId = uid(700);
      await client.query(
        `INSERT INTO batches (id, batch_code, name, status, volume_bbl)
         VALUES ($1, 'TTBREC-700', 'Internal movements only', 'packaging', 10)`,
        [batchId]
      );
      for (const destinationType of ["finished_good", "transfer", "batch"]) {
        await client.query(
          `INSERT INTO allocations
             (source_type, source_id, destination_type, destination_id,
              quantity, volume_bbl, status, completed_at)
           VALUES ('batch', $1, $2, NULL, 3, 3, 'completed', NOW())`,
          [batchId, destinationType]
        );
      }

      const delta = removalsDelta(before, await readRemovals(client, y, m));
      expect(delta.cellar).toEqual(ZERO_REMOVALS);
      expect(delta.keg).toEqual(ZERO_REMOVALS);
      expect(delta.bottled).toEqual(ZERO_REMOVALS);

      // Read those three assertions honestly: they hold with the exclusion
      // clause AND without it. Verified by mutation on a from-scratch chain
      // replay — dropping the clause out of get_ttb_removals_summary left all
      // 9 numeric TTB tests in this file and ttb-removals-batch-losses green,
      // because no removals SUM arm names 'finished_good', 'transfer' or
      // 'batch', so those rows contribute 0 whether the CTE admits them or
      // not. 00274's header says the same thing: "the exclusion is currently a
      // no-op on the numbers".
      //
      // Which is exactly why the clause needs a structural assertion as well.
      // It is a forward guard: the day someone adds a removals arm for one of
      // these destination types, the clause is the only thing standing between
      // the report and double-counted packaged beer, and by then no existing
      // number would have flinched to warn them. Deleting it must break a
      // test, so it breaks this one — and after this line was added, that same
      // mutation fails exactly here and nowhere else (1 failed | 8 passed).
      const { rows } = await client.query<{ def: string }>(
        `SELECT pg_get_functiondef(
           'public.get_ttb_removals_summary(integer,integer)'::regprocedure
         ) AS def`
      );
      expect(rows[0].def.replace(/\s+/g, " ")).toMatch(
        /NOT \( a\.source_type = 'batch' AND a\.destination_type IN \('finished_good', 'transfer', 'batch'\) \)/
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("does not book a second loss when the batch was already reconciled", async () => {
    const client = await pool.connect();
    try {
      await beginBounded(client);
      const { y, m } = await reportingPeriod(client);
      const before = await readRemovals(client, y, m);
      const fx = await seedBatchFixture(client, 300);
      await packageBatch(client, fx);

      // A prior writer (archive_batch, or a retried completion) already claimed
      // the reconciliation key with a 0.40 bbl loss.
      await client.query(
        `INSERT INTO allocations
           (source_type, source_id, destination_type, destination_id,
            quantity, volume_bbl, status, completed_at, reason_code, idempotency_key)
         VALUES ('batch', $1, 'loss', NULL, 0.40, 0.40, 'completed', NOW(),
                 'reconciliation', $2)`,
        [fx.batchId, `batch_reconcile:${fx.batchId}`]
      );

      const { rows: result } = await client.query<{
        transition_entity_atomic: { reconciled_loss_bbl: string | number };
      }>(
        `SELECT transition_entity_atomic('batches', $1, 'packaging', 'completed', '{}'::jsonb)`,
        [fx.batchId]
      );
      expect(Number(result[0].transition_entity_atomic.reconciled_loss_bbl)).toBe(0);

      const { rows: losses } = await client.query<{ n: string; total: string }>(
        `SELECT count(*) AS n, COALESCE(sum(volume_bbl), 0) AS total
         FROM allocations
         WHERE source_type = 'batch' AND source_id = $1 AND destination_type = 'loss'`,
        [fx.batchId]
      );
      expect(Number(losses[0].n)).toBe(1);
      expect(Number(losses[0].total)).toBe(0.4);

      const delta = removalsDelta(before, await readRemovals(client, y, m));
      expect(delta.cellar.losses_bbl).toBe(0.4);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

/**
 * Seeds the same packaging shape as `seedBatchFixture` but with a KEG
 * container, which routes create_finished_goods_from_packaging (00232) down its
 * `c.type = 'keg'` fill branch. `containers_keg_needs_bbl` requires volume_bbl
 * on a keg container, so it is set explicitly (0.5 bbl, matching 1984 fl oz).
 */
async function seedKegPackagingFixture(client: PoolClient, base: number) {
  const brandId = uid(base + 1);
  const containerId = uid(base + 2);
  const formatId = uid(base + 3);
  const batchId = uid(base + 4);
  const sessionId = uid(base + 5);
  const lineId = uid(base + 6);

  await client.query(`INSERT INTO brands (id, name) VALUES ($1, $2)`, [
    brandId,
    `TTB keg brand ${base}`,
  ]);
  await client.query(
    `INSERT INTO containers (id, name, type, volume_bbl, volume_oz)
     VALUES ($1, $2, 'keg', 0.5, 1984)`,
    [containerId, `TTB keg half barrel ${base}`]
  );
  await client.query(
    `INSERT INTO selling_formats (id, container_id, name, unit_count)
     VALUES ($1, $2, $3, 1)`,
    [formatId, containerId, `TTB keg single unit ${base}`]
  );
  await client.query(
    `INSERT INTO batches (id, batch_code, name, status, volume_bbl)
     VALUES ($1, $2, 'TTB keg packaging batch', 'packaging', 10)`,
    [batchId, `TTBKEG-${base}`]
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
     VALUES ($1, $2, $3, $4, $5, 17, 17)`,
    [lineId, sessionId, brandId, formatId, batchId]
  );
  return { brandId, formatId, batchId, sessionId, lineId };
}

/**
 * Is the keg fill blocked on THIS database?
 *
 * 00032 created `keg_transactions.keg_type_id` NOT NULL and no migration in the
 * chain ever drops it (00183's own header notes the drop lived in a migration
 * that was "since renumbered/squashed" out). So a from-scratch replay — what
 * db-lint.yml runs, and the repository's own definition of the schema — has the
 * column and the fill insert in 00183 does not supply it. A database that took
 * the squashed drop out-of-band does not have the column at all and the same
 * insert succeeds. Both states exist right now: verified with
 * `information_schema.columns` against a fresh 257-migration replay (NOT NULL
 * present) and against a local Supabase database predating the squash (column
 * absent).
 *
 * The read is the same one an operator would do to answer "is #701 live?",
 * which `live-catalog.snapshot.txt` cannot answer — it records tables, not
 * column nullability.
 */
async function kegFillBlockedByNotNull(client: PoolClient): Promise<boolean> {
  const { rows } = await client.query<{ blocked: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'keg_transactions'
         AND column_name = 'keg_type_id'
         AND is_nullable = 'NO'
     ) AS blocked`
  );
  return rows[0].blocked;
}

/**
 * Criterion 5 names "packaging material consumption/output". Every packaging
 * fixture in this repository — the `'package'` one above, and the pre-existing
 * packaging-completion-trigger / packaging-material-consumption suites — uses a
 * `'package'` container, so the keg half of that workflow was covered by
 * nothing. It is also broken on a replayed database (#701), and a broken path
 * with no test is exactly the shape of gap #437 exists to close: a fully green
 * database gate over a production workflow that cannot execute.
 *
 * So this does not assert one fixed outcome. It reads the schema first and then
 * requires the outcome that schema mandates — which makes it real coverage in
 * both worlds instead of a skip in one of them:
 *
 *  - keg_type_id NOT NULL (the migration chain, and therefore CI): the line
 *    MUST fail, and criterion 6 still applies to a path that fails, so nothing
 *    partial may survive. This is #701's tracked reproduction.
 *  - column dropped out-of-band: the line MUST complete, and the finished good,
 *    the keg fill transaction and the batch allocation must all be there. This
 *    is the keg packaging-output coverage criterion 5 asks for.
 *
 * It is sensitive in both directions, so it needs no manual retirement: fixing
 * #701 by relaxing the column moves it to the success branch on its own, and
 * fixing it by supplying keg_type_id in the function turns it red the same day
 * — which is the correct signal, because this file would then be asserting a
 * failure that no longer happens.
 */
describe("keg-container packaging output (#701)", () => {
  it("packages a keg line whole, or refuses it whole", async () => {
    const client = await pool.connect();
    try {
      await beginBounded(client);
      const blocked = await kegFillBlockedByNotNull(client);
      const fx = await seedKegPackagingFixture(client, 800);

      await client.query("SAVEPOINT before_keg_packaging");
      let failure: Error | null = null;
      try {
        await client.query(
          `SELECT transition_entity_atomic('packaging_sessions', $1, 'in_progress', 'completed', '{}'::jsonb)`,
          [fx.sessionId]
        );
      } catch (err) {
        failure = err as Error;
        await client.query("ROLLBACK TO SAVEPOINT before_keg_packaging");
      }

      // The outcome is not free-floating: the schema decides it. A keg line
      // that failed on a database where it should work — or worse, one that
      // succeeded halfway on a database where it cannot — lands here.
      expect(
        failure !== null,
        failure
          ? `keg packaging failed on a database that permits it: ${failure.message}`
          : "keg packaging succeeded even though keg_type_id is still NOT NULL"
      ).toBe(blocked);

      const { rows: state } = await client.query<{
        session_status: string;
        finished_goods: string;
        keg_fills: string;
        batch_allocations: string;
      }>(
        `SELECT
           (SELECT status FROM packaging_sessions WHERE id = $1) AS session_status,
           (SELECT count(*) FROM finished_goods
             WHERE session_line_item_id = $2 AND quantity = 17) AS finished_goods,
           (SELECT count(*) FROM keg_transactions
             WHERE packaging_session_id = $1
               AND transaction_type = 'fill' AND quantity = 17
               AND from_state = 'empty' AND to_state = 'filled') AS keg_fills,
           (SELECT count(*) FROM allocations
             WHERE source_type = 'batch' AND source_id = $3
               AND destination_type = 'finished_good'
               AND status = 'completed') AS batch_allocations`,
        [fx.sessionId, fx.lineId, fx.batchId]
      );

      if (blocked) {
        // create_finished_goods_from_packaging's fill insert (00183) omits
        // keg_type_id. The finished good and the batch allocation are written
        // BEFORE it in the same loop iteration, so "nothing partial" is a real
        // claim about the rollback, not a restatement of the error.
        expect(failure?.message).toMatch(/null value in column "keg_type_id"/);
        expect(state[0]).toEqual({
          session_status: "in_progress",
          finished_goods: "0",
          keg_fills: "0",
          batch_allocations: "0",
        });
      } else {
        // Packaging output for a keg container: stock, the keg ledger's fill,
        // and the batch -> finished_good movement that takes the volume out of
        // the cellar, all present together.
        expect(state[0]).toEqual({
          session_status: "completed",
          finished_goods: "1",
          keg_fills: "1",
          batch_allocations: "1",
        });
      }
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

describe("batch completion failure leaves no partial ledger", () => {
  it("unwinds the loss, the vessel release, and the ingredient allocations together", async () => {
    const client = await pool.connect();
    try {
      await beginBounded(client);
      const { y, m } = await reportingPeriod(client);
      const before = await readRemovals(client, y, m);
      const fx = await seedBatchFixture(client, 400);
      await packageBatch(client, fx);

      // Inject a failure on the reconciliation write specifically. It is the
      // LAST accounting statement before the vessel release, so a raise here
      // proves everything on both sides of it unwinds: the batch status, the
      // confirmed ingredient allocations, and the vessel release.
      await client.query(`
        CREATE FUNCTION pg_temp.fail_reconciliation()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $fn$
        BEGIN
          IF NEW.reason_code = 'reconciliation' THEN
            RAISE EXCEPTION 'injected reconciliation ledger failure';
          END IF;
          RETURN NEW;
        END;
        $fn$;
        CREATE TRIGGER fail_reconciliation
          BEFORE INSERT ON allocations
          FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_reconciliation();
      `);

      await client.query("SAVEPOINT before_completion");
      await expect(
        client.query(
          `SELECT transition_entity_atomic('batches', $1, 'packaging', 'completed', '{}'::jsonb)`,
          [fx.batchId]
        )
      ).rejects.toThrow("injected reconciliation ledger failure");
      await client.query("ROLLBACK TO SAVEPOINT before_completion");

      // 1. Batch status did not advance.
      const { rows: batch } = await client.query<{ status: string; completed_at: Date | null }>(
        `SELECT status, completed_at FROM batches WHERE id = $1`,
        [fx.batchId]
      );
      expect(batch).toEqual([{ status: "packaging", completed_at: null }]);

      // 2. No loss row exists.
      const { rows: losses } = await client.query<{ n: string }>(
        `SELECT count(*) AS n FROM allocations
         WHERE source_type = 'batch' AND source_id = $1 AND destination_type = 'loss'`,
        [fx.batchId]
      );
      expect(Number(losses[0].n)).toBe(0);

      // 3. The ingredient allocation is still planned — not half-confirmed.
      const { rows: ingredient } = await client.query<{
        status: string;
        completed_at: Date | null;
      }>(`SELECT status, completed_at FROM allocations WHERE id = $1`, [
        fx.ingredientAllocId,
      ]);
      expect(ingredient).toEqual([{ status: "planned", completed_at: null }]);

      // 4. The vessel was not released, so it cannot be filled with a new batch
      //    while the old one is still recorded as in it.
      const { rows: vessel } = await client.query<{
        status: string;
        current_batch_id: string | null;
      }>(`SELECT status, current_batch_id FROM vessels WHERE id = $1`, [fx.vesselId]);
      expect(vessel).toEqual([{ status: "in_use", current_batch_id: fx.batchId }]);

      // 5. Nothing reached the excise report.
      const delta = removalsDelta(before, await readRemovals(client, y, m));
      expect(delta.cellar).toEqual({ ...ZERO_REMOVALS, tax_free_samples_bbl: 0.25 });
      expect(delta.keg).toEqual(ZERO_REMOVALS);
      expect(delta.bottled).toEqual(ZERO_REMOVALS);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
