/**
 * Atomic entity transition integration regressions (issue #434).
 *
 * These tests use a real PostgreSQL transaction. The injected trigger models
 * an inventory/accounting statement failing after the batch status UPDATE;
 * rolling back to the savepoint lets the test inspect both rows and prove the
 * RPC left neither half committed.
 */

import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const BATCH_ID = "00000000-0000-0000-0434-000000000001";
const ALLOCATION_ID = "00000000-0000-0000-0434-000000000002";

afterAll(async () => {
  await pool.end();
});

async function seedBatch(client: import("pg").PoolClient, suffix: string) {
  const batchId = `${BATCH_ID.slice(0, -1)}${suffix}`;
  const allocationId = `${ALLOCATION_ID.slice(0, -1)}${suffix}`;
  await client.query(
    `INSERT INTO batches (id, batch_code, name, status)
     VALUES ($1, $2, 'Atomic transition integration test', 'packaging')`,
    [batchId, `ATOMIC-${suffix}`]
  );
  await client.query(
    `INSERT INTO allocations (
       id, source_type, source_id, destination_type, destination_id,
       quantity, status
     ) VALUES ($1, 'inventory_lot', $2, 'batch', $3, 1, 'planned')`,
    [allocationId, "00000000-0000-0000-0434-000000000099", batchId]
  );
  return { batchId, allocationId };
}

describe("transition_entity_atomic", () => {
  it("commits the status and batch-consumption allocation together", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { batchId, allocationId } = await seedBatch(client, "1");

      await client.query(
        "SELECT transition_entity_atomic('batches', $1, 'packaging', 'completed', '{}'::jsonb)",
        [batchId]
      );

      const result = await client.query<{ batch_status: string; allocation_status: string }>(
        `SELECT b.status AS batch_status, a.status AS allocation_status
         FROM batches b
         JOIN allocations a ON a.id = $2
         WHERE b.id = $1`,
        [batchId, allocationId]
      );
      expect(result.rows).toEqual([
        { batch_status: "completed", allocation_status: "completed" },
      ]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("rolls status back when an injected side effect fails", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { batchId, allocationId } = await seedBatch(client, "2");
      await client.query(`
        CREATE FUNCTION pg_temp.fail_atomic_allocation()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $function$
        BEGIN
          IF NEW.destination_id = '${BATCH_ID.slice(0, -1)}2'::uuid
             AND NEW.status = 'completed' THEN
            RAISE EXCEPTION 'injected side-effect failure';
          END IF;
          RETURN NEW;
        END;
        $function$;
        CREATE TRIGGER fail_atomic_allocation
          BEFORE UPDATE ON allocations
          FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_atomic_allocation();
      `);
      await client.query("SAVEPOINT before_transition");

      await expect(
        client.query(
          "SELECT transition_entity_atomic('batches', $1, 'packaging', 'completed', '{}'::jsonb)",
          [batchId]
        )
      ).rejects.toThrow("injected side-effect failure");
      await client.query("ROLLBACK TO SAVEPOINT before_transition");

      const result = await client.query<{ batch_status: string; allocation_status: string }>(
        `SELECT b.status AS batch_status, a.status AS allocation_status
         FROM batches b
         JOIN allocations a ON a.id = $2
         WHERE b.id = $1`,
        [batchId, allocationId]
      );
      expect(result.rows).toEqual([
        { batch_status: "packaging", allocation_status: "planned" },
      ]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
