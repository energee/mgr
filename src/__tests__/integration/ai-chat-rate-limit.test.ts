/**
 * Staff AI permission and durable chat limiter regressions (issue #448).
 */

import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  SEEDED_UUIDS,
  teardownPool,
  withRoleClient,
} from "./_helpers/role-client";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });

afterAll(async () => {
  await teardownPool();
  await pool.end();
});

describe("ai:use permission", () => {
  it("maps every staff role and excludes customer", async () => {
    await withRoleClient("admin", async (db) => {
      const { rows } = await db.query<{ roles: string[] }>(
        "SELECT get_roles_for_permission('ai:use') AS roles",
      );
      expect(rows[0].roles).toEqual([
        "admin",
        "production_manager",
        "brewer",
        "sales",
        "viewer",
      ]);
    });
  });

  it.each([
    ["viewer", true],
    ["production_manager", true],
    ["admin", true],
    ["no_profile", false],
    ["active_customer", false],
  ] as const)("evaluates %s => %s", async (role, expected) => {
    await withRoleClient(role, async (db) => {
      const { rows } = await db.query<{ allowed: boolean }>(
        "SELECT user_has_permission('ai:use') AS allowed",
      );
      expect(rows[0].allowed).toBe(expected);
    });
  });
});

describe("consume_ai_rate_limit", () => {
  it("is callable only by service_role", async () => {
    await withRoleClient("admin", async (db) => {
      const { rows } = await db.query<{
        anon_function: boolean;
        authenticated_function: boolean;
        service_function: boolean;
        anon_table: boolean;
        authenticated_table: boolean;
        service_table: boolean;
      }>(`
        SELECT
          has_function_privilege('anon', 'public.consume_ai_rate_limit(uuid,integer,integer)', 'EXECUTE') AS anon_function,
          has_function_privilege('authenticated', 'public.consume_ai_rate_limit(uuid,integer,integer)', 'EXECUTE') AS authenticated_function,
          has_function_privilege('service_role', 'public.consume_ai_rate_limit(uuid,integer,integer)', 'EXECUTE') AS service_function,
          has_table_privilege('anon', 'public.ai_rate_limit_buckets', 'SELECT') AS anon_table,
          has_table_privilege('authenticated', 'public.ai_rate_limit_buckets', 'SELECT') AS authenticated_table,
          has_table_privilege('service_role', 'public.ai_rate_limit_buckets', 'SELECT') AS service_table
      `);
      expect(rows).toEqual([{
        anon_function: false,
        authenticated_function: false,
        service_function: true,
        anon_table: false,
        authenticated_table: false,
        service_table: false,
      }]);
    });
  });

  it("allows exactly the configured number of requests in a window", async () => {
    const db = await pool.connect();
    try {
      await db.query("DELETE FROM ai_rate_limit_buckets WHERE user_id = $1", [SEEDED_UUIDS.viewer]);
      await db.query("SET ROLE service_role");

      const outcomes: boolean[] = [];
      for (let requestNumber = 0; requestNumber < 4; requestNumber += 1) {
        const { rows } = await db.query<{ allowed: boolean }>(
          "SELECT allowed FROM consume_ai_rate_limit($1, 60, 3)",
          [SEEDED_UUIDS.viewer],
        );
        outcomes.push(rows[0].allowed);
      }

      expect(outcomes).toEqual([true, true, true, false]);
    } finally {
      await db.query("RESET ROLE");
      db.release();
    }
  });

  it("resets an expired window", async () => {
    const db = await pool.connect();
    try {
      await db.query(
        "UPDATE ai_rate_limit_buckets SET window_started_at = now() - interval '2 minutes', request_count = 99 WHERE user_id = $1",
        [SEEDED_UUIDS.viewer],
      );
      await db.query("SET ROLE service_role");
      const { rows } = await db.query<{ allowed: boolean; remaining: number }>(
        "SELECT allowed, remaining FROM consume_ai_rate_limit($1, 60, 3)",
        [SEEDED_UUIDS.viewer],
      );
      expect(rows).toEqual([{ allowed: true, remaining: 2 }]);
    } finally {
      await db.query("RESET ROLE");
      db.release();
    }
  });

  it("serializes concurrent requests into one shared bucket", async () => {
    const setup = await pool.connect();
    try {
      await setup.query("DELETE FROM ai_rate_limit_buckets WHERE user_id = $1", [SEEDED_UUIDS.admin]);
    } finally {
      setup.release();
    }

    const run = async () => {
      const db = await pool.connect();
      try {
        await db.query("SET ROLE service_role");
        const { rows } = await db.query<{ allowed: boolean }>(
          "SELECT allowed FROM consume_ai_rate_limit($1, 60, 1)",
          [SEEDED_UUIDS.admin],
        );
        return rows[0].allowed;
      } finally {
        await db.query("RESET ROLE");
        db.release();
      }
    };

    expect((await Promise.all([run(), run()])).sort()).toEqual([false, true]);
  });
});
