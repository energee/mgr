/**
 * TTB in-process terms must be period-keyed history, not a status snapshot
 * (issue #618).
 *
 * Behavioral (real Postgres) regression for the Form 5130.9 beer-in-process
 * line. Pre-00287, `get_ttb_inventory_summary`'s `ip_ending` summed
 * `batches.volume_bbl` for every batch *currently* in fermenting/conditioning/
 * packaging with no date filter at all, and `ip_beginning` filtered that same
 * present-tense set by `created_at` — so re-running a closed month returned a
 * different number every time a batch changed status, and a month's ending
 * never had to equal the next month's beginning.
 *
 * Migration 00287 reconstructs each batch's recorded status at the period
 * boundaries from `entity_revisions` (the audit trail migration 00019 has kept
 * on batches since before any TTB data existed), which is issue #618's
 * option 1: closed months become reproducible, and both boundaries are the
 * same reconstruction so ending(M) == beginning(M+1) by construction.
 *
 * Everything runs inside one transaction that is always rolled back, so the
 * suite commits no rows. The reporting period is far past (2001), so the
 * revisions the batches INSERT trigger writes at now() cannot leak into it.
 *
 * Run locally:   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
 *                bun run test:integration
 */

import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

afterAll(async () => {
  await pool.end();
});

/** Reporting period used by every case — far past, so no fixture data collides. */
const YEAR = 2001;
const MONTH = 3;

type InventoryRow = {
  ttb_tax_class: string;
  in_process_beginning_bbl: string;
  in_process_ending_bbl: string;
};

/** The cellar row of get_ttb_inventory_summary for a period, as numbers. */
async function cellarInProcess(
  client: import("pg").PoolClient,
  year: number,
  month: number
) {
  const { rows } = await client.query<InventoryRow>(
    `SELECT ttb_tax_class, in_process_beginning_bbl, in_process_ending_bbl
     FROM get_ttb_inventory_summary($1, $2) WHERE ttb_tax_class = 'cellar'`,
    [year, month]
  );
  expect(rows).toHaveLength(1);
  return {
    beginning: Number(rows[0].in_process_beginning_bbl),
    ending: Number(rows[0].in_process_ending_bbl),
  };
}

/**
 * Inserts a batch (whose live status is whatever the LAST transition says) and
 * hand-writes its audit-trail history with explicit timestamps, mimicking what
 * the log_entity_revision trigger records at each status change. The trigger's
 * own revision for the INSERT lands at now() (2026+), far after the 2001
 * reporting period, so it cannot affect these boundaries.
 */
async function seedBatchHistory(
  client: import("pg").PoolClient,
  code: string,
  volumeBbl: number,
  transitions: Array<{ at: string; status: string; volumeBbl?: number; deleted?: boolean }>
): Promise<string> {
  const liveStatus = transitions[transitions.length - 1].deleted
    ? "completed"
    : transitions[transitions.length - 1].status;
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO batches (batch_code, name, status, volume_bbl)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [code, `TTB 618 ${code}`, liveStatus, volumeBbl]
  );
  const batchId = rows[0].id;

  for (const [i, t] of transitions.entries()) {
    await client.query(
      `INSERT INTO entity_revisions
         (entity_type, entity_id, revision_number, operation, changed_at, new_data)
       VALUES ('batches', $1, $2, $3, $4, $5)`,
      [
        batchId,
        // The trigger already wrote revision 1 at now(); history starts above it.
        i + 100,
        t.deleted ? "DELETE" : "UPDATE",
        t.at,
        t.deleted
          ? null
          : JSON.stringify({ id: batchId, status: t.status, volume_bbl: t.volumeBbl ?? volumeBbl }),
      ]
    );
  }
  return batchId;
}

describe("get_ttb_inventory_summary — period-keyed in-process terms (issue #618)", () => {
  it("reports a closed month from history even after the batch has since completed", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // The issue's repro: a 10.00 bbl batch that was fermenting all of March
      // 2001 but whose LIVE status is now 'completed'. The snapshot
      // implementation returns 0 for March; the period-keyed one must return 10.
      await seedBatchHistory(client, "TTB618A", 10.0, [
        { at: "2001-03-05T12:00:00Z", status: "fermenting" },
        { at: "2001-04-10T12:00:00Z", status: "completed" },
      ]);

      const march = await cellarInProcess(client, YEAR, MONTH);
      // Created mid-March: not in the cellar on March 1…
      expect(march.beginning).toBe(0);
      // …but demonstrably in the cellar at March end, whatever happened since.
      expect(march.ending).toBe(10.0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("counts a batch that was in the cellar at period start even if it completed mid-period", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Pre-00287 ip_beginning required the batch's CURRENT status to be
      // in-process; a batch fermenting on March 1 that completed on March 20
      // was dropped from March's beginning balance.
      await seedBatchHistory(client, "TTB618B", 7.5, [
        { at: "2001-02-20T12:00:00Z", status: "fermenting" },
        { at: "2001-03-20T12:00:00Z", status: "completed" },
      ]);

      const march = await cellarInProcess(client, YEAR, MONTH);
      expect(march.beginning).toBe(7.5);
      expect(march.ending).toBe(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("makes a month's in-process ending equal the next month's beginning", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await seedBatchHistory(client, "TTB618C", 12.25, [
        { at: "2001-03-10T12:00:00Z", status: "fermenting" },
        { at: "2001-04-02T12:00:00Z", status: "conditioning" },
        { at: "2001-04-25T12:00:00Z", status: "completed" },
      ]);

      const march = await cellarInProcess(client, YEAR, 3);
      const april = await cellarInProcess(client, YEAR, 4);
      expect(march.ending).toBe(12.25);
      expect(april.beginning).toBe(march.ending);
      expect(april.ending).toBe(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("values a batch at the volume recorded at the boundary, not its volume today", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Volume corrected 10.00 -> 9.00 mid-March; live row says 9.00 either
      // way, but the point is the March-1 boundary reads the March-1 record.
      await seedBatchHistory(client, "TTB618D", 9.0, [
        { at: "2001-02-15T12:00:00Z", status: "fermenting", volumeBbl: 10.0 },
        { at: "2001-03-12T12:00:00Z", status: "fermenting", volumeBbl: 9.0 },
      ]);

      const march = await cellarInProcess(client, YEAR, MONTH);
      expect(march.beginning).toBe(10.0);
      expect(march.ending).toBe(9.0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("drops a deleted batch from every boundary after its DELETE revision", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // A DELETE revision carries new_data NULL, so the reconstruction sees no
      // status and the batch stops counting — no special-casing required.
      await seedBatchHistory(client, "TTB618E", 5.0, [
        { at: "2001-02-01T12:00:00Z", status: "fermenting" },
        { at: "2001-03-15T12:00:00Z", status: "fermenting", deleted: true },
      ]);

      const march = await cellarInProcess(client, YEAR, MONTH);
      expect(march.beginning).toBe(5.0);
      expect(march.ending).toBe(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
