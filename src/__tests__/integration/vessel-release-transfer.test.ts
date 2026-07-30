/**
 * Vessel release and vessel-to-vessel transfer against real Postgres
 * (issue #437, acceptance criteria 5 and 6).
 *
 * Two writers own vessel occupancy, and both are database-side:
 *  - `transition_entity_atomic` (00256) frees the vessel a batch is sitting in
 *    when that batch completes — the last side effect of the batch arm, after
 *    the ingredient allocations and the loss reconciliation.
 *  - `handle_vessel_transfer` (00023, currently the 00235 definition), an AFTER
 *    INSERT trigger on vessel_transfers, claims the destination vessel and
 *    frees the source ONLY when the transfer ledger proves the source emptied.
 *    A claim the ledger contradicts is corrected rather than trusted (00228);
 *    a claim it merely cannot prove is kept but does not free the vessel
 *    (00235), because batch allocations carry no vessel id.
 *
 * The failure-path tests assert the ABSENCE of partial state — a vessel freed
 * for a batch whose completion rolled back would be filled with new wort while
 * the old batch is still recorded in it, and a destination claimed by a
 * transfer that then failed would block the vessel forever.
 *
 * `ttb-loss-reconciliation.test.ts` covers the same batch-completion boundary
 * from the accounting side, with the failure injected on the reconciliation
 * write instead of on the vessel update.
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

/** Deterministic UUID namespace for this suite: issue 0437, sub-range 0005. */
function uid(n: number): string {
  return `00000000-0000-0000-0437-0005${String(n).padStart(8, "0")}`;
}

afterAll(async () => {
  await pool.end();
});

/**
 * Opens a transaction with bounded lock waits. Every test in this file starts
 * here.
 *
 * `leaves the vessel occupied when the completion fails` issues CREATE TRIGGER
 * on `vessels`, which takes ACCESS EXCLUSIVE on a shared table and holds it
 * until this transaction ends — so any other test in this file, or in a sibling
 * suite, that touches `vessels` while it runs waits on it. Unbounded, that
 * contention surfaces as an opaque `Test timed out in 15000ms`; bounded,
 * Postgres names the statement that could not get its lock. Both values sit
 * under vitest's 15s testTimeout so the database error wins the race. Same
 * rationale as inventory-guard-concurrency.test.ts's `beginBounded`.
 */
async function beginBounded(client: PoolClient): Promise<void> {
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query("SET LOCAL statement_timeout = '10s'");
}

type VesselState = { status: string; current_batch_id: string | null };

async function readVessel(client: PoolClient, vesselId: string): Promise<VesselState> {
  const { rows } = await client.query<VesselState>(
    `SELECT status, current_batch_id FROM vessels WHERE id = $1`,
    [vesselId]
  );
  return rows[0];
}

/** Seeds one packaging-state batch occupying one fermenter. */
async function seedBatchInVessel(client: PoolClient, base: number) {
  const batchId = uid(base + 1);
  const vesselId = uid(base + 2);
  await client.query(
    `INSERT INTO batches (id, batch_code, name, status, volume_bbl)
     VALUES ($1, $2, 'Vessel release batch', 'packaging', 10)`,
    [batchId, `VESREL-${base}`]
  );
  await client.query(
    `INSERT INTO vessels (id, name, vessel_type, capacity_bbl, status, current_batch_id)
     VALUES ($1, $2, 'fermenter', 20, 'in_use', $3)`,
    [vesselId, `Vessel release FV ${base}`, batchId]
  );
  return { batchId, vesselId };
}

describe("batch completion releases the vessel", () => {
  it("frees the fermenter the completed batch was sitting in", async () => {
    const client = await pool.connect();
    try {
      await beginBounded(client);
      const { batchId, vesselId } = await seedBatchInVessel(client, 100);

      await client.query(
        `SELECT transition_entity_atomic('batches', $1, 'packaging', 'completed', '{}'::jsonb)`,
        [batchId]
      );

      // 'dirty' rather than 'ready_for_use': the vessel still needs cleaning.
      expect(await readVessel(client, vesselId)).toEqual({
        status: "dirty",
        current_batch_id: null,
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("leaves the vessel occupied when the completion fails", async () => {
    const client = await pool.connect();
    try {
      await beginBounded(client);
      const { batchId, vesselId } = await seedBatchInVessel(client, 200);
      // A planned ingredient allocation, confirmed earlier in the same call
      // than the vessel release: it must roll back too.
      await client.query(
        `INSERT INTO inventory_items (id, category, name, unit)
         VALUES ($1, 'grain', $2, 'lb')`,
        [uid(210), `Vessel release grain 200`]
      );
      await client.query(
        `INSERT INTO inventory_lots (id, inventory_item_id, quantity, unit)
         VALUES ($1, $2, 500, 'lb')`,
        [uid(211), uid(210)]
      );
      await client.query(
        `INSERT INTO allocations
           (id, source_type, source_id, destination_type, destination_id, quantity, status)
         VALUES ($1, 'inventory_lot', $2, 'batch', $3, 400, 'planned')`,
        [uid(212), uid(211), batchId]
      );

      // Inject the failure on the vessel release itself — the last statement of
      // the batch arm — so the assertions below prove the whole call unwound,
      // not just the tail of it.
      await client.query(`
        CREATE FUNCTION pg_temp.fail_vessel_release()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $fn$
        BEGIN
          IF NEW.current_batch_id IS NULL AND OLD.current_batch_id IS NOT NULL THEN
            RAISE EXCEPTION 'injected vessel release failure';
          END IF;
          RETURN NEW;
        END;
        $fn$;
        CREATE TRIGGER fail_vessel_release
          BEFORE UPDATE ON vessels
          FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_vessel_release();
      `);

      await client.query("SAVEPOINT before_completion");
      await expect(
        client.query(
          `SELECT transition_entity_atomic('batches', $1, 'packaging', 'completed', '{}'::jsonb)`,
          [batchId]
        )
      ).rejects.toThrow("injected vessel release failure");
      await client.query("ROLLBACK TO SAVEPOINT before_completion");

      expect(await readVessel(client, vesselId)).toEqual({
        status: "in_use",
        current_batch_id: batchId,
      });
      const { rows: batch } = await client.query<{ status: string; completed_at: Date | null }>(
        `SELECT status, completed_at FROM batches WHERE id = $1`,
        [batchId]
      );
      expect(batch).toEqual([{ status: "packaging", completed_at: null }]);
      const { rows: allocation } = await client.query<{
        status: string;
        completed_at: Date | null;
      }>(`SELECT status, completed_at FROM allocations WHERE id = $1`, [uid(212)]);
      expect(allocation).toEqual([{ status: "planned", completed_at: null }]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

type TransferFixture = {
  batchId: string;
  sourceId: string;
  destId: string;
};

/**
 * Seeds a batch knocked out into a fermenter (a 10 bbl transfer with no source
 * vessel), plus an empty brite tank to move it to. The inbound transfer is what
 * makes the ledger able to PROVE whether a later outbound move empties the
 * fermenter — without it, `handle_vessel_transfer` can only trust the caller.
 */
async function seedTransferFixture(
  client: PoolClient,
  base: number
): Promise<TransferFixture> {
  const batchId = uid(base + 1);
  const sourceId = uid(base + 2);
  const destId = uid(base + 3);

  await client.query(
    `INSERT INTO batches (id, batch_code, name, status, volume_bbl)
     VALUES ($1, $2, 'Vessel transfer batch', 'conditioning', 10)`,
    [batchId, `VESXFER-${base}`]
  );
  await client.query(
    `INSERT INTO vessels (id, name, vessel_type, capacity_bbl, status, current_batch_id)
     VALUES ($1, $2, 'fermenter', 20, 'in_use', $4),
            ($3, $5, 'brite', 20, 'ready_for_use', NULL)`,
    [
      sourceId,
      `Vessel transfer FV ${base}`,
      destId,
      batchId,
      `Vessel transfer BT ${base}`,
    ]
  );
  // Knockout from the kettle: 10 bbl into the fermenter, no source vessel.
  await client.query(
    `INSERT INTO vessel_transfers (id, batch_id, from_vessel_id, to_vessel_id, volume_bbl)
     VALUES ($1, $2, NULL, $3, 10)`,
    [uid(base + 4), batchId, sourceId]
  );
  return { batchId, sourceId, destId };
}

describe("handle_vessel_transfer", () => {
  it("frees the source and claims the destination on a ledger-proven full move", async () => {
    const client = await pool.connect();
    try {
      await beginBounded(client);
      const fx = await seedTransferFixture(client, 300);

      await client.query(
        `INSERT INTO vessel_transfers
           (id, batch_id, from_vessel_id, to_vessel_id, volume_bbl, empties_source)
         VALUES ($1, $2, $3, $4, 10, true)`,
        [uid(310), fx.batchId, fx.sourceId, fx.destId]
      );

      expect(await readVessel(client, fx.sourceId)).toEqual({
        status: "dirty",
        current_batch_id: null,
      });
      expect(await readVessel(client, fx.destId)).toEqual({
        status: "in_use",
        current_batch_id: fx.batchId,
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("leaves both vessels untouched when the destination holds another batch", async () => {
    const client = await pool.connect();
    try {
      await beginBounded(client);
      const fx = await seedTransferFixture(client, 400);
      // Someone else already filled the brite tank.
      const otherBatchId = uid(410);
      await client.query(
        `INSERT INTO batches (id, batch_code, name, status, volume_bbl)
         VALUES ($1, 'VESXFER-OTHER-400', 'Occupying batch', 'conditioning', 8)`,
        [otherBatchId]
      );
      await client.query(
        `UPDATE vessels SET status = 'in_use', current_batch_id = $2 WHERE id = $1`,
        [fx.destId, otherBatchId]
      );

      await client.query("SAVEPOINT before_transfer");
      await expect(
        client.query(
          `INSERT INTO vessel_transfers
             (id, batch_id, from_vessel_id, to_vessel_id, volume_bbl, empties_source)
           VALUES ($1, $2, $3, $4, 10, true)`,
          [uid(411), fx.batchId, fx.sourceId, fx.destId]
        )
      ).rejects.toThrow(/already holds a different batch/);
      await client.query("ROLLBACK TO SAVEPOINT before_transfer");

      // No partial state: the source was not freed (it still holds the beer
      // that never moved), the destination still holds the other batch, and no
      // transfer row survives to imply the move happened.
      expect(await readVessel(client, fx.sourceId)).toEqual({
        status: "in_use",
        current_batch_id: fx.batchId,
      });
      expect(await readVessel(client, fx.destId)).toEqual({
        status: "in_use",
        current_batch_id: otherBatchId,
      });
      const { rows } = await client.query<{ n: string }>(
        `SELECT count(*) AS n FROM vessel_transfers WHERE from_vessel_id = $1`,
        [fx.sourceId]
      );
      expect(Number(rows[0].n)).toBe(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("corrects an empties_source claim the ledger contradicts", async () => {
    const client = await pool.connect();
    try {
      await beginBounded(client);
      const fx = await seedTransferFixture(client, 500);

      // 4 of the 10 bbl moved, but the operator's client claimed a full move.
      // Nothing else explains the missing 6 bbl, so 00228 corrects the flag
      // rather than freeing a vessel that still has beer in it.
      await client.query(
        `INSERT INTO vessel_transfers
           (id, batch_id, from_vessel_id, to_vessel_id, volume_bbl, empties_source)
         VALUES ($1, $2, $3, $4, 4, true)`,
        [uid(510), fx.batchId, fx.sourceId, fx.destId]
      );

      const { rows } = await client.query<{ empties_source: boolean }>(
        `SELECT empties_source FROM vessel_transfers WHERE id = $1`,
        [uid(510)]
      );
      expect(rows).toEqual([{ empties_source: false }]);
      expect(await readVessel(client, fx.sourceId)).toEqual({
        status: "in_use",
        current_batch_id: fx.batchId,
      });
      expect(await readVessel(client, fx.destId)).toEqual({
        status: "in_use",
        current_batch_id: fx.batchId,
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("keeps an empties_source claim recorded losses make plausible, without freeing the vessel", async () => {
    const client = await pool.connect();
    try {
      await beginBounded(client);
      const fx = await seedTransferFixture(client, 600);
      // 6 bbl of the batch is recorded as lost. Allocations carry no vessel id,
      // so this can justify KEEPING the operator's flag but never justify
      // freeing this particular vessel (00235).
      await client.query(
        `INSERT INTO allocations
           (source_type, source_id, destination_type, destination_id,
            quantity, volume_bbl, status, completed_at, reason_code)
         VALUES ('batch', $1, 'loss', NULL, 6, 6, 'completed', NOW(), 'transfer_loss')`,
        [fx.batchId]
      );

      await client.query(
        `INSERT INTO vessel_transfers
           (id, batch_id, from_vessel_id, to_vessel_id, volume_bbl, empties_source)
         VALUES ($1, $2, $3, $4, 4, true)`,
        [uid(610), fx.batchId, fx.sourceId, fx.destId]
      );

      const { rows } = await client.query<{ empties_source: boolean }>(
        `SELECT empties_source FROM vessel_transfers WHERE id = $1`,
        [uid(610)]
      );
      // The audit flag is NOT falsified...
      expect(rows).toEqual([{ empties_source: true }]);
      // ...but the vessel is still not freed on an unprovable claim.
      expect(await readVessel(client, fx.sourceId)).toEqual({
        status: "in_use",
        current_batch_id: fx.batchId,
      });
      // The destination claim proves the trigger actually ran: without it, the
      // two assertions above would also hold on a database with no trigger at
      // all, and this test would pass vacuously.
      expect(await readVessel(client, fx.destId)).toEqual({
        status: "in_use",
        current_batch_id: fx.batchId,
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
