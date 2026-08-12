import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { teardownPool, withRoleClient } from "./_helpers/role-client";

afterAll(async () => {
  await teardownPool();
});

describe("MongoDB aggregate reconciliation RPCs", () => {
  it("rolls back a failed recipe aggregate and retries idempotently", async () => {
    await withRoleClient("admin", async (db) => {
      const suffix = randomUUID();
      const mongoId = `recipe-${suffix}`;
      const recipeId = randomUUID();
      const badMaltId = randomUUID();
      const manualMaltId = randomUUID();
      const manualRecipeMaltId = randomUUID();

      await db.query(
        `INSERT INTO recipes (id, name, status, boil_time_min)
         VALUES ($1, $2, 'complete', 60)`,
        [recipeId, `Atomic recipe ${suffix}`],
      );
      await db.query("INSERT INTO malts (id, name) VALUES ($1, $2)", [manualMaltId, `Manual malt ${suffix}`]);
      await db.query(
        `INSERT INTO recipe_malts (id, recipe_id, malt_id, weight_lbs)
         VALUES ($1, $2, $3, 5)`,
        [manualRecipeMaltId, recipeId, manualMaltId],
      );

      await db.query("SAVEPOINT failed_recipe_reconcile");
      try {
        await expect(db.query(
          `SELECT reconcile_mongodb_recipe_aggregate($1, $2::jsonb, $3::jsonb, '[]'::jsonb, '[]'::jsonb)`,
          [
            mongoId,
            JSON.stringify({ id: recipeId, name: `Changed ${suffix}`, status: "complete", boil_time_min: 90 }),
            JSON.stringify([{
              id: randomUUID(),
              mongo_id: `${mongoId}:malt:0`,
              malt_id: badMaltId,
              weight_lbs: 10,
              position: 0,
            }]),
          ],
        )).rejects.toThrow();
      } finally {
        await db.query("ROLLBACK TO SAVEPOINT failed_recipe_reconcile");
      }

      const { rows: afterFailure } = await db.query<{ name: string; boil_time_min: number }>(
        "SELECT name, boil_time_min FROM recipes WHERE id = $1",
        [recipeId],
      );
      expect(afterFailure).toEqual([{ name: `Atomic recipe ${suffix}`, boil_time_min: 60 }]);

      const args = [
        mongoId,
        JSON.stringify({ id: recipeId, name: `Changed ${suffix}`, status: "complete", boil_time_min: 90 }),
      ];
      await db.query(
        `SELECT reconcile_mongodb_recipe_aggregate($1, $2::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`,
        args,
      );
      await db.query(
        `SELECT reconcile_mongodb_recipe_aggregate($1, $2::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`,
        args,
      );

      const { rows: afterRetry } = await db.query<{ count: string; name: string; boil_time_min: number }>(
        `SELECT count(*)::text AS count, min(name) AS name, min(boil_time_min)::int AS boil_time_min
           FROM recipes
          WHERE id = $1`,
        [recipeId],
      );
      expect(afterRetry).toEqual([{ count: "1", name: `Changed ${suffix}`, boil_time_min: 90 }]);
      // 00288: a mapped recipe owns its ingredient list wholesale, so the reconcile
      // above (called with an empty malts array) deletes this pre-existing row along
      // with every other child, rather than leaving it untouched.
      const { rows: manualRows } = await db.query<{ id: string }>(
        "SELECT id FROM recipe_malts WHERE id = $1",
        [manualRecipeMaltId],
      );
      expect(manualRows).toEqual([]);
    });
  });

  it("rolls back failed production readings without deleting the previous aggregate", async () => {
    await withRoleClient("admin", async (db) => {
      const suffix = randomUUID();
      const batchId = randomUUID();
      const readingId = randomUUID();
      const manualReadingId = randomUUID();
      const mongoId = `test-${suffix}`;

      await db.query(
        `INSERT INTO batches (id, batch_code, name, status) VALUES ($1, $2, $2, 'planned')`,
        [batchId, `ATOMIC-${suffix}`],
      );
      await db.query(
        `INSERT INTO batch_logs (id, batch_id, log_type, data)
         VALUES ($1, $2, 'measurement', '{"value": 65}'::jsonb)`,
        [readingId, batchId],
      );
      await db.query(
        `INSERT INTO batch_logs (id, batch_id, log_type, data)
         VALUES ($1, $2, 'measurement', '{"value": 68}'::jsonb)`,
        [manualReadingId, batchId],
      );
      await db.query(
        `INSERT INTO mongodb_sync_mappings (entity_type, mongo_id, pg_id)
         VALUES ('batch_logs', $1, $2)`,
        [`${mongoId}:temperature`, readingId],
      );

      await db.query("SAVEPOINT failed_reading_reconcile");
      try {
        await expect(db.query(
          `SELECT reconcile_mongodb_batch_reading_aggregate($1, $2::jsonb)`,
          [mongoId, JSON.stringify([{
            id: readingId,
            mongo_id: `${mongoId}:temperature`,
            batch_id: randomUUID(),
            log_type: "measurement",
            data: { value: 72 },
          }])],
        )).rejects.toThrow();
      } finally {
        await db.query("ROLLBACK TO SAVEPOINT failed_reading_reconcile");
      }

      const { rows } = await db.query<{ data: { value: number } }>(
        "SELECT data FROM batch_logs WHERE id = $1",
        [readingId],
      );
      expect(rows).toEqual([{ data: { value: 65 } }]);

      const validReadings = JSON.stringify([{
        id: readingId,
        mongo_id: `${mongoId}:temperature`,
        batch_id: batchId,
        log_type: "measurement",
        data: { value: 72 },
      }]);
      await db.query("SELECT reconcile_mongodb_batch_reading_aggregate($1, $2::jsonb)", [mongoId, validReadings]);
      await db.query("SELECT reconcile_mongodb_batch_reading_aggregate($1, $2::jsonb)", [mongoId, validReadings]);
      const { rows: retained } = await db.query<{ id: string; data: { value: number } }>(
        "SELECT id, data FROM batch_logs WHERE id IN ($1, $2) ORDER BY id",
        [readingId, manualReadingId],
      );
      expect(retained).toHaveLength(2);
      expect(retained.find((row) => row.id === readingId)?.data).toEqual({ value: 72 });
      expect(retained.find((row) => row.id === manualReadingId)?.data).toEqual({ value: 68 });
    });
  });

  it("rolls back a failed brew-log aggregate and retries without duplicate links", async () => {
    await withRoleClient("admin", async (db) => {
      const suffix = randomUUID();
      const brewId = randomUUID();
      const batchId = randomUUID();
      const mongoId = `brew-${suffix}`;
      const brewNumber = `BRW-2026-${suffix.slice(0, 6)}`;

      await db.query(
        `INSERT INTO batches (id, batch_code, name, status) VALUES ($1, $2, $2, 'planned')`,
        [batchId, `BREW-${suffix}`],
      );
      await db.query(
        `INSERT INTO brew_logs (id, brew_number, brew_date, status, notes)
         VALUES ($1, $2, '2026-07-15', 'completed', 'original')`,
        [brewId, brewNumber],
      );
      await db.query(
        `INSERT INTO mongodb_sync_mappings (entity_type, mongo_id, pg_id)
         VALUES ('brew_logs', $1, $2)`,
        [mongoId, brewId],
      );

      await db.query("SAVEPOINT failed_brew_reconcile");
      try {
        await expect(db.query(
          `SELECT reconcile_mongodb_brew_aggregate($1, $2::jsonb, $3::jsonb)`,
          [
            mongoId,
            JSON.stringify({ id: brewId, brew_number: brewNumber, brew_date: "2026-07-15", status: "completed", notes: "changed" }),
            JSON.stringify([{
              id: randomUUID(),
              mongo_id: `${mongoId}:batch:bad`,
              batch_id: randomUUID(),
              volume_bbl: 20,
            }]),
          ],
        )).rejects.toThrow();
      } finally {
        await db.query("ROLLBACK TO SAVEPOINT failed_brew_reconcile");
      }

      const { rows: afterFailure } = await db.query<{ notes: string }>(
        "SELECT notes FROM brew_logs WHERE id = $1",
        [brewId],
      );
      expect(afterFailure).toEqual([{ notes: "original" }]);

      const childId = randomUUID();
      const validBatches = JSON.stringify([{
        id: childId,
        mongo_id: `${mongoId}:batch:${batchId}`,
        batch_id: batchId,
        volume_bbl: 20,
      }]);
      const brewPayload = JSON.stringify({ id: brewId, brew_number: brewNumber, brew_date: "2026-07-15", status: "completed", notes: "changed" });
      await db.query("SELECT reconcile_mongodb_brew_aggregate($1, $2::jsonb, $3::jsonb)", [mongoId, brewPayload, validBatches]);
      await db.query("SELECT reconcile_mongodb_brew_aggregate($1, $2::jsonb, $3::jsonb)", [mongoId, brewPayload, validBatches]);
      const { rows: links } = await db.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM brew_log_batches WHERE brew_log_id = $1",
        [brewId],
      );
      expect(links).toEqual([{ count: "1" }]);
    });
  });

  it("rolls back a failed packaging aggregate and retries idempotently", async () => {
    await withRoleClient("admin", async (db) => {
      const suffix = randomUUID();
      const sessionId = randomUUID();
      const mongoId = `packaging-${suffix}`;

      await db.query(
        `INSERT INTO packaging_sessions (id, session_date, status, notes)
         VALUES ($1, '2026-07-15', 'planned', 'original')`,
        [sessionId],
      );
      await db.query(
        `INSERT INTO mongodb_sync_mappings (entity_type, mongo_id, pg_id)
         VALUES ('packaging_sessions', $1, $2)`,
        [mongoId, sessionId],
      );

      const sessionPayload = JSON.stringify({
        id: sessionId,
        session_date: "2026-07-15",
        status: "planned",
        notes: "changed",
      });
      await db.query("SAVEPOINT failed_packaging_reconcile");
      try {
        await expect(db.query(
          `SELECT reconcile_mongodb_packaging_aggregate($1, $2::jsonb, $3::jsonb)`,
          [mongoId, sessionPayload, JSON.stringify([{
            id: randomUUID(),
            mongo_id: `${mongoId}:line:bad`,
            brand_id: randomUUID(),
            planned_quantity: 10,
          }])],
        )).rejects.toThrow();
      } finally {
        await db.query("ROLLBACK TO SAVEPOINT failed_packaging_reconcile");
      }

      const { rows: afterFailure } = await db.query<{ notes: string }>(
        "SELECT notes FROM packaging_sessions WHERE id = $1",
        [sessionId],
      );
      expect(afterFailure).toEqual([{ notes: "original" }]);

      await db.query("SELECT reconcile_mongodb_packaging_aggregate($1, $2::jsonb, '[]'::jsonb)", [mongoId, sessionPayload]);
      await db.query("SELECT reconcile_mongodb_packaging_aggregate($1, $2::jsonb, '[]'::jsonb)", [mongoId, sessionPayload]);
      const { rows: afterRetry } = await db.query<{ count: string; notes: string }>(
        `SELECT count(*)::text AS count, min(notes) AS notes
           FROM packaging_sessions WHERE id = $1`,
        [sessionId],
      );
      expect(afterRetry).toEqual([{ count: "1", notes: "changed" }]);
    });
  });
});
