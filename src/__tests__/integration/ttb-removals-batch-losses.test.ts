/**
 * TTB removals: batch-sourced removals must reach the report (issue #603).
 *
 * Behavioral (real Postgres) regression for the Form 5130.9 `Losses` line.
 * Every writer of a cellar loss emits `source_type='batch'`,
 * `destination_type='loss'` (src/services/consumption-service.ts
 * `recordBatchLoss`, `archive_batch`, and the completion reconciliation inside
 * `transition_entity_atomic`), but `get_ttb_removals_summary` narrowed its CTE
 * to `source_type = 'finished_good'`, so `losses_bbl` was structurally 0.00 for
 * all in-process beer. Migration 00274 admits batch-sourced removals and
 * classifies them as `cellar`.
 *
 * Everything runs inside one transaction that is always rolled back, so the
 * suite commits no rows.
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
/** Inside the period; the completed_at-first key (00237) buckets on this. */
const IN_PERIOD = "2001-03-15T12:00:00Z";

type RemovalsRow = {
  ttb_tax_class: string;
  taxpaid_domestic_bbl: string;
  taxpaid_export_bbl: string;
  tax_free_samples_bbl: string;
  losses_bbl: string;
  destroyed_bbl: string;
  adjustments_bbl: string;
};

/** Row for one tax class, with numeric strings coerced to numbers. */
function classRow(rows: RemovalsRow[], taxClass: string) {
  const row = rows.find((r) => r.ttb_tax_class === taxClass);
  if (!row) throw new Error(`no ${taxClass} row in removals summary`);
  return {
    taxpaid_domestic_bbl: Number(row.taxpaid_domestic_bbl),
    taxpaid_export_bbl: Number(row.taxpaid_export_bbl),
    tax_free_samples_bbl: Number(row.tax_free_samples_bbl),
    losses_bbl: Number(row.losses_bbl),
    destroyed_bbl: Number(row.destroyed_bbl),
    adjustments_bbl: Number(row.adjustments_bbl),
  };
}

/**
 * Seeds the scenario from issue #603: a 10.00 bbl batch that packages 8.50 bbl,
 * takes a 0.25 bbl sample and a 0.15 bbl inter-vessel transfer, and books a
 * 1.10 bbl reconciliation loss at completion. Also seeds a keg finished good
 * with its own 0.50 bbl loss and 1.00 bbl taproom sale, so the pre-existing
 * finished-goods arms can be pinned as unchanged.
 */
async function seedScenario(client: import("pg").PoolClient) {
  const { rows: batchRows } = await client.query<{ id: string }>(
    `INSERT INTO batches (batch_code, name, status, volume_bbl)
     VALUES ('TTB603', 'TTB 603 losses regression', 'packaging', 10.00)
     RETURNING id`
  );
  const batchId = batchRows[0].id;

  const { rows: brandRows } = await client.query<{ id: string }>(
    `INSERT INTO brands (name) VALUES ('TTB 603 Brand') RETURNING id`
  );
  const { rows: containerRows } = await client.query<{ id: string }>(
    `INSERT INTO containers (name, type, volume_bbl)
     VALUES ('TTB 603 Half Barrel', 'keg', 0.5) RETURNING id`
  );
  const { rows: formatRows } = await client.query<{ id: string }>(
    `INSERT INTO selling_formats (container_id, name, unit_count)
     VALUES ($1, 'TTB 603 Single Keg', 1) RETURNING id`,
    [containerRows[0].id]
  );
  const { rows: fgRows } = await client.query<{ id: string }>(
    `INSERT INTO finished_goods
       (batch_id, brand_id, selling_format_id, quantity, lot_number, production_date)
     VALUES ($1, $2, $3, 17, 'TTB603-LOT', '2001-03-10') RETURNING id`,
    [batchId, brandRows[0].id, formatRows[0].id]
  );
  const fgId = fgRows[0].id;

  // Every allocation below is completed inside the reporting period.
  const alloc = (
    sourceType: string,
    sourceId: string,
    destinationType: string,
    volumeBbl: number,
    reasonCode: string | null
  ) =>
    client.query(
      `INSERT INTO allocations
         (source_type, source_id, destination_type, destination_id,
          quantity, volume_bbl, status, completed_at, reason_code)
       VALUES ($1, $2, $3, NULL, $4, $4, 'completed', $5, $6)`,
      [sourceType, sourceId, destinationType, volumeBbl, IN_PERIOD, reasonCode]
    );

  // Cellar (batch-sourced) activity.
  await alloc("batch", batchId, "loss", 1.1, "reconciliation");
  await alloc("batch", batchId, "sample", 0.25, "sample_quality");
  // Packaging: volume leaves the cellar via the packaging/production terms, so
  // this must NOT also be reported as a removal.
  await alloc("batch", batchId, "finished_good", 8.5, null);
  // Inter-vessel move: not a removal from the brewery either.
  await alloc("batch", batchId, "transfer", 0.15, null);

  // Finished-goods activity (the arm that already worked).
  await alloc("finished_good", fgId, "loss", 0.5, "breakage");
  await alloc("finished_good", fgId, "taproom_sale", 1.0, null);

  return { batchId, fgId };
}

describe("get_ttb_removals_summary — batch-sourced removals (issue #603)", () => {
  it("reports a batch-sourced loss in the cellar losses_bbl line", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await seedScenario(client);

      const { rows } = await client.query<RemovalsRow>(
        "SELECT * FROM get_ttb_removals_summary($1, $2)",
        [YEAR, MONTH]
      );
      const cellar = classRow(rows, "cellar");

      // The reconciliation loss (00256) and the manual/archive losses all land
      // here; before 00274 this was structurally 0.00.
      expect(cellar.losses_bbl).toBe(1.1);
      // Batch samples classify like their finished-goods counterparts.
      expect(cellar.tax_free_samples_bbl).toBe(0.25);
      // Packaging (8.50) and the inter-vessel transfer (0.15) are not removals.
      expect(cellar.taxpaid_domestic_bbl).toBe(0);
      expect(cellar.taxpaid_export_bbl).toBe(0);
      expect(cellar.destroyed_bbl).toBe(0);
      expect(cellar.adjustments_bbl).toBe(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("keeps batch-sourced removals out of the keg and bottled rows", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await seedScenario(client);

      const { rows } = await client.query<RemovalsRow>(
        "SELECT * FROM get_ttb_removals_summary($1, $2)",
        [YEAR, MONTH]
      );

      // Without an explicit 'cellar' arm, batch rows fall through
      // COALESCE(get_ttb_tax_class(NULL), 'bottled') and are misfiled here.
      const bottled = classRow(rows, "bottled");
      expect(bottled.losses_bbl).toBe(0);
      expect(bottled.tax_free_samples_bbl).toBe(0);

      // The finished-goods arm is unchanged: the keg's own loss and taproom
      // sale still report, and the batch's do not leak into them.
      const keg = classRow(rows, "keg");
      expect(keg.losses_bbl).toBe(0.5);
      expect(keg.taxpaid_domestic_bbl).toBe(1.0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("propagates the cellar loss through get_ttb_report into total_removals_bbl", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await seedScenario(client);

      const { rows } = await client.query<{
        ttb_tax_class: string;
        losses_bbl: string;
        total_removals_bbl: string;
      }>(
        `SELECT ttb_tax_class, losses_bbl, total_removals_bbl
         FROM get_ttb_report($1, $2) WHERE ttb_tax_class = 'cellar'`,
        [YEAR, MONTH]
      );

      expect(rows).toHaveLength(1);
      expect(Number(rows[0].losses_bbl)).toBe(1.1);
      // 1.10 loss + 0.25 sample; packaging and the transfer are excluded.
      expect(Number(rows[0].total_removals_bbl)).toBe(1.35);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
