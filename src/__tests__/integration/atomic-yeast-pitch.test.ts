/**
 * Real-Postgres regressions for atomic yeast pitching (#447).
 *
 * Client mocks cannot prove row-lock serialization or transaction rollback,
 * so these tests exercise the database command and its defensive table
 * triggers directly against the disposable integration database.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import {
  SEEDED_UUIDS,
  teardownPool,
  withRoleClient,
} from "./_helpers/role-client";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });

type Fixture = {
  batchAId: string;
  batchBId: string;
  pitchId: string;
  yeastId: string;
};

type PitchResult = {
  kind: "created" | "duplicate";
  event_id: string;
  remaining_quantity_lbs: number;
  status: string;
};

afterAll(async () => {
  await teardownPool();
  await pool.end();
});

async function withTransaction<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    return await fn(db);
  } finally {
    await db.query("ROLLBACK").catch(() => undefined);
    db.release();
  }
}

async function createFixture(
  db: PoolClient,
  suffix: string,
  quantityLbs = 5,
): Promise<Fixture> {
  const { rows: yeasts } = await db.query<{ id: string }>(
    "INSERT INTO yeasts (name) VALUES ($1) RETURNING id",
    [`Atomic yeast ${suffix}`],
  );
  const { rows: batches } = await db.query<{ id: string }>(
    `INSERT INTO batches (name, status)
     VALUES ($1, 'planned'), ($2, 'planned')
     RETURNING id`,
    [`Atomic batch A ${suffix}`, `Atomic batch B ${suffix}`],
  );
  const { rows: pitches } = await db.query<{ id: string }>(
    `INSERT INTO yeast_pitches (
       strain_id, source_type, generation, status, quantity_lbs,
       cell_density_thousand, initial_viability, received_date
     ) VALUES ($1, 'purchase', 0, 'in_stock', $2, 1000, 95, CURRENT_DATE)
     RETURNING id`,
    [yeasts[0]!.id, quantityLbs],
  );

  return {
    batchAId: batches[0]!.id,
    batchBId: batches[1]!.id,
    pitchId: pitches[0]!.id,
    yeastId: yeasts[0]!.id,
  };
}

async function pitchYeast(
  db: PoolClient,
  fixture: Fixture,
  requestId: string,
  quantityLbs: number,
  batchId = fixture.batchAId,
  notes: string | null = null,
): Promise<PitchResult> {
  const { rows } = await db.query<{ result: PitchResult }>(
    `SELECT pitch_yeast_atomic(
       $1::uuid, $2::uuid, $3::uuid, $4::numeric, $5::numeric, $6::text
     ) AS result`,
    [requestId, fixture.pitchId, batchId, quantityLbs, 95, notes],
  );
  return rows[0]!.result;
}

async function readPitch(db: PoolClient, fixture: Fixture) {
  const { rows: pitches } = await db.query<{
    quantity_remaining_lbs: number;
    status: string;
  }>(
    `SELECT quantity_remaining_lbs::float8, status
     FROM yeast_pitches_with_remaining WHERE id = $1`,
    [fixture.pitchId],
  );
  const { rows: events } = await db.query<{
    id: string;
    batch_id: string;
    quantity_lbs: number;
  }>(
    `SELECT id, batch_id, quantity_lbs::float8
     FROM yeast_pitch_events WHERE pitch_id = $1 ORDER BY id`,
    [fixture.pitchId],
  );
  return { ...pitches[0]!, events };
}

async function deleteCommittedFixture(db: PoolClient, fixture: Fixture) {
  await db.query("SET LOCAL session_replication_role = replica");
  await db.query("DELETE FROM yeast_pitch_events WHERE pitch_id = $1", [fixture.pitchId]);
  await db.query("DELETE FROM yeast_pitches WHERE id = $1", [fixture.pitchId]);
  await db.query("DELETE FROM batches WHERE id = ANY($1::uuid[])", [
    [fixture.batchAId, fixture.batchBId],
  ]);
  await db.query("DELETE FROM yeasts WHERE id = $1", [fixture.yeastId]);
}

describe("pitch_yeast_atomic", () => {
  it("is an invoker-rights command with an explicit search path and narrow grants", async () => {
    await withTransaction(async (db) => {
      const { rows } = await db.query<{
        is_security_definer: boolean;
        proconfig: string[];
        anon_can_execute: boolean;
        authenticated_can_execute: boolean;
        service_role_can_execute: boolean;
      }>(`
        SELECT
          p.prosecdef AS is_security_definer,
          p.proconfig,
          has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
          has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'pitch_yeast_atomic'
      `);

      expect(rows).toEqual([
        {
          is_security_definer: false,
          proconfig: ["search_path=public"],
          anon_can_execute: false,
          authenticated_can_execute: true,
          service_role_can_execute: true,
        },
      ]);
    });
  });

  it("creates one event for an identical retry and rejects request-id reuse with new input", async () => {
    await withTransaction(async (db) => {
      const fixture = await createFixture(db, randomUUID());
      const requestId = randomUUID();

      await expect(pitchYeast(db, fixture, requestId, 2, fixture.batchAId, "first")).resolves.toMatchObject({
        kind: "created",
        event_id: requestId,
        remaining_quantity_lbs: 3,
        status: "in_stock",
      });
      await expect(pitchYeast(db, fixture, requestId, 2, fixture.batchAId, "first")).resolves.toMatchObject({
        kind: "duplicate",
        event_id: requestId,
        remaining_quantity_lbs: 3,
      });
      await db.query("SAVEPOINT reused_request");
      await expect(
        pitchYeast(db, fixture, requestId, 1, fixture.batchAId, "changed"),
      ).rejects.toMatchObject({ code: "PT409" });
      await db.query("ROLLBACK TO SAVEPOINT reused_request");
      expect((await readPitch(db, fixture)).events).toHaveLength(1);
    });
  });

  it("rejects zero, negative, over-precision, and overdraw quantities", async () => {
    await withTransaction(async (db) => {
      const fixture = await createFixture(db, randomUUID());

      for (const quantity of [0, -1, 0.001]) {
        await db.query("SAVEPOINT invalid_quantity");
        await expect(pitchYeast(db, fixture, randomUUID(), quantity)).rejects.toBeDefined();
        await db.query("ROLLBACK TO SAVEPOINT invalid_quantity");
      }

      await db.query("SAVEPOINT overdraw");
      await expect(pitchYeast(db, fixture, randomUUID(), 6)).rejects.toMatchObject({
        code: "PT409",
      });
      await db.query("ROLLBACK TO SAVEPOINT overdraw");

      expect(await readPitch(db, fixture)).toMatchObject({
        quantity_remaining_lbs: 5,
        status: "in_stock",
        events: [],
      });
    });
  });

  it("rolls the event back if depleted-status maintenance fails, then retries once", async () => {
    await withTransaction(async (db) => {
      const suffix = randomUUID().replaceAll("-", "");
      const fixture = await createFixture(db, suffix);
      const requestId = randomUUID();
      const functionName = `fail_yeast_depletion_${suffix}`;
      const triggerName = `fail_yeast_depletion_${suffix}`;

      await db.query(`
        CREATE FUNCTION ${functionName}() RETURNS trigger
        LANGUAGE plpgsql SET search_path = public AS $body$
        BEGIN
          IF NEW.status = 'depleted' AND OLD.status <> 'depleted' THEN
            RAISE EXCEPTION 'injected yeast depletion failure';
          END IF;
          RETURN NEW;
        END
        $body$;
        CREATE TRIGGER ${triggerName}
          BEFORE UPDATE ON yeast_pitches
          FOR EACH ROW EXECUTE FUNCTION ${functionName}();
      `);

      await db.query("SAVEPOINT failed_pitch");
      await expect(pitchYeast(db, fixture, requestId, 5)).rejects.toThrow(
        "injected yeast depletion failure",
      );
      await db.query("ROLLBACK TO SAVEPOINT failed_pitch");
      expect(await readPitch(db, fixture)).toMatchObject({
        quantity_remaining_lbs: 5,
        status: "in_stock",
        events: [],
      });

      await db.query(`
        DROP TRIGGER ${triggerName} ON yeast_pitches;
        DROP FUNCTION ${functionName}();
      `);
      await expect(pitchYeast(db, fixture, requestId, 5)).resolves.toMatchObject({
        kind: "created",
        remaining_quantity_lbs: 0,
        status: "depleted",
      });
      await expect(pitchYeast(db, fixture, requestId, 5)).resolves.toMatchObject({
        kind: "duplicate",
      });
      expect(await readPitch(db, fixture)).toMatchObject({
        quantity_remaining_lbs: 0,
        status: "depleted",
        events: [{ id: requestId, batch_id: fixture.batchAId, quantity_lbs: 5 }],
      });
    });
  });

  it("protects direct table inserts from non-positive quantities and overdraw", async () => {
    await withTransaction(async (db) => {
      const fixture = await createFixture(db, randomUUID());
      await db.query(
        `INSERT INTO yeast_pitch_events (pitch_id, batch_id, quantity_lbs)
         VALUES ($1, $2, 4)`,
        [fixture.pitchId, fixture.batchAId],
      );

      await db.query("SAVEPOINT direct_overdraw");
      await expect(
        db.query(
          `INSERT INTO yeast_pitch_events (pitch_id, batch_id, quantity_lbs)
           VALUES ($1, $2, 2)`,
          [fixture.pitchId, fixture.batchBId],
        ),
      ).rejects.toMatchObject({ code: "PT409" });
      await db.query("ROLLBACK TO SAVEPOINT direct_overdraw");

      await db.query("SAVEPOINT direct_zero");
      await expect(
        db.query(
          `INSERT INTO yeast_pitch_events (pitch_id, batch_id, quantity_lbs)
           VALUES ($1, $2, 0)`,
          [fixture.pitchId, fixture.batchBId],
        ),
      ).rejects.toBeDefined();
      await db.query("ROLLBACK TO SAVEPOINT direct_zero");

      await db.query("SAVEPOINT direct_invalid_viability");
      await expect(
        db.query(
          `INSERT INTO yeast_pitch_events (
             pitch_id, batch_id, quantity_lbs, viability_at_pitch
           ) VALUES ($1, $2, 1, 101)`,
          [fixture.pitchId, fixture.batchBId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await db.query("ROLLBACK TO SAVEPOINT direct_invalid_viability");

      await db.query("SAVEPOINT immutable_update");
      await expect(
        db.query(
          "UPDATE yeast_pitch_events SET quantity_lbs = 3 WHERE pitch_id = $1",
          [fixture.pitchId],
        ),
      ).rejects.toMatchObject({ code: "55000" });
      await db.query("ROLLBACK TO SAVEPOINT immutable_update");

      await db.query("SAVEPOINT immutable_delete");
      await expect(
        db.query("DELETE FROM yeast_pitch_events WHERE pitch_id = $1", [
          fixture.pitchId,
        ]),
      ).rejects.toMatchObject({ code: "55000" });
      await db.query("ROLLBACK TO SAVEPOINT immutable_delete");

      expect(await readPitch(db, fixture)).toMatchObject({
        quantity_remaining_lbs: 1,
        status: "in_stock",
        events: [expect.objectContaining({ quantity_lbs: 4 })],
      });

      await db.query("SAVEPOINT reduce_source");
      await expect(
        db.query("UPDATE yeast_pitches SET quantity_lbs = 3 WHERE id = $1", [
          fixture.pitchId,
        ]),
      ).rejects.toMatchObject({ code: "PT409" });
      await db.query("ROLLBACK TO SAVEPOINT reduce_source");
      expect(await readPitch(db, fixture)).toMatchObject({
        quantity_remaining_lbs: 1,
        status: "in_stock",
      });
    });
  });

  it("enforces permissions through invoker RLS and stamps the authenticated user", async () => {
    const suffix = randomUUID();
    const setup = await pool.connect();
    let fixture: Fixture | undefined;

    try {
      await setup.query("BEGIN");
      fixture = await createFixture(setup, suffix, 5);
      await setup.query("COMMIT");

      await withRoleClient("production_manager", async (db) => {
        const requestId = randomUUID();
        await expect(pitchYeast(db, fixture!, requestId, 2)).resolves.toMatchObject({
          kind: "created",
        });
        const { rows } = await db.query<{ created_by: string }>(
          "SELECT created_by FROM yeast_pitch_events WHERE id = $1",
          [requestId],
        );
        expect(rows).toEqual([{ created_by: SEEDED_UUIDS.production_manager }]);
      });

      for (const role of ["viewer", "inactive_admin"] as const) {
        await withRoleClient(role, async (db) => {
          await expect(
            pitchYeast(db, fixture!, randomUUID(), 1),
          ).rejects.toMatchObject({ code: "42501" });
        });
      }
    } finally {
      try {
        if (fixture) {
          await setup.query("BEGIN");
          await deleteCommittedFixture(setup, fixture);
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

  it("serializes concurrent direct inserts so the trigger prevents overdraw", async () => {
    const suffix = randomUUID();
    const setup = await pool.connect();
    let fixture: Fixture | undefined;

    try {
      await setup.query("BEGIN");
      fixture = await createFixture(setup, suffix, 5);
      await setup.query("COMMIT");

      const first = await pool.connect();
      const second = await pool.connect();
      try {
        const attempts = await Promise.allSettled([
          first.query(
            `INSERT INTO yeast_pitch_events (pitch_id, batch_id, quantity_lbs)
             VALUES ($1, $2, 4)`,
            [fixture.pitchId, fixture.batchAId],
          ),
          second.query(
            `INSERT INTO yeast_pitch_events (pitch_id, batch_id, quantity_lbs)
             VALUES ($1, $2, 4)`,
            [fixture.pitchId, fixture.batchBId],
          ),
        ]);
        expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(attempts.find((result) => result.status === "rejected")).toMatchObject({
          status: "rejected",
          reason: { code: "PT409" },
        });
      } finally {
        first.release();
        second.release();
      }

      expect(await readPitch(setup, fixture)).toMatchObject({
        quantity_remaining_lbs: 1,
        status: "in_stock",
        events: [expect.objectContaining({ quantity_lbs: 4 })],
      });
    } finally {
      try {
        if (fixture) {
          await setup.query("BEGIN");
          await deleteCommittedFixture(setup, fixture);
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

  it("serializes concurrent valid pitches and prevents concurrent overdraw", async () => {
    const suffix = randomUUID();
    const setup = await pool.connect();
    let fixture: Fixture | undefined;

    try {
      await setup.query("BEGIN");
      fixture = await createFixture(setup, suffix, 5);
      await setup.query("COMMIT");

      const first = await pool.connect();
      const second = await pool.connect();
      try {
        const valid = await Promise.all([
          pitchYeast(first, fixture, randomUUID(), 2, fixture.batchAId),
          pitchYeast(second, fixture, randomUUID(), 2, fixture.batchBId),
        ]);
        expect(valid.map((result) => result.kind)).toEqual(["created", "created"]);
      } finally {
        first.release();
        second.release();
      }

      expect(await readPitch(setup, fixture)).toMatchObject({
        quantity_remaining_lbs: 1,
        status: "in_stock",
        events: [expect.any(Object), expect.any(Object)],
      });

      const overdrawA = await pool.connect();
      const overdrawB = await pool.connect();
      try {
        const attempts = await Promise.allSettled([
          pitchYeast(overdrawA, fixture, randomUUID(), 1, fixture.batchAId),
          pitchYeast(overdrawB, fixture, randomUUID(), 1, fixture.batchBId),
        ]);
        expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        const rejected = attempts.find((result) => result.status === "rejected");
        expect(rejected).toMatchObject({
          status: "rejected",
          reason: { code: "PT409" },
        });
      } finally {
        overdrawA.release();
        overdrawB.release();
      }

      expect(await readPitch(setup, fixture)).toMatchObject({
        quantity_remaining_lbs: 0,
        status: "depleted",
        events: [expect.any(Object), expect.any(Object), expect.any(Object)],
      });
    } finally {
      await setup.query("ROLLBACK").catch(() => undefined);
      try {
        if (fixture) {
          await setup.query("BEGIN");
          await deleteCommittedFixture(setup, fixture);
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
});
