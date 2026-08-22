/**
 * Real-Postgres regressions for save_qbo_tokens_atomic (00297, #855).
 *
 * The unit tests prove which RPC saveTokens calls; only Postgres can prove
 * the migration's central claims: the CAS compares jsonb-to-jsonb against
 * values written the way supabase-js wrote them (no client encoding
 * assumption), a miss writes nothing at all (no torn window), and all four
 * rows land together.
 */

import { afterAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { requireDatabaseUrl } from "./_helpers/role-client";

const pool = new Pool({ connectionString: requireDatabaseUrl(), max: 4 });

afterAll(async () => {
  await pool.end();
});

async function withTransaction<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    // Seed data may include qbo_* rows; start each case from none (rolled back).
    await db.query("DELETE FROM system_settings WHERE key LIKE 'qbo_%'");
    return await fn(db);
  } finally {
    await db.query("ROLLBACK").catch(() => undefined);
    db.release();
  }
}

async function save(
  db: PoolClient,
  expected: string | null,
  tokens = { at: "at-new", rt: "rt-new", realm: "realm-1", exp: "2026-01-01T00:00:00.000Z" }
): Promise<boolean> {
  const { rows } = await db.query<{ saved: boolean }>(
    "SELECT save_qbo_tokens_atomic($1, $2, $3, $4, $5) AS saved",
    [tokens.at, tokens.rt, tokens.realm, tokens.exp, expected]
  );
  return rows[0]!.saved;
}

async function readSettings(db: PoolClient): Promise<Map<string, string>> {
  const { rows } = await db.query<{ key: string; value: string }>(
    "SELECT key, value #>> '{}' AS value FROM system_settings WHERE key LIKE 'qbo_%'"
  );
  return new Map(rows.map((r) => [r.key, r.value]));
}

describe("save_qbo_tokens_atomic", () => {
  it("connect path (NULL expectation): writes all four rows unconditionally", async () => {
    await withTransaction(async (db) => {
      expect(await save(db, null)).toBe(true);
      const settings = await readSettings(db);
      expect(settings.get("qbo_access_token")).toBe("at-new");
      expect(settings.get("qbo_refresh_token")).toBe("rt-new");
      expect(settings.get("qbo_realm_id")).toBe("realm-1");
      expect(settings.get("qbo_token_expires_at")).toBe("2026-01-01T00:00:00.000Z");
    });
  });

  it("refresh path: CAS hit against a supabase-js-encoded stored value updates all four rows", async () => {
    await withTransaction(async (db) => {
      // Seed the way PostgREST stored it pre-00297: a jsonb string literal.
      await db.query(
        `INSERT INTO system_settings (key, value) VALUES
           ('qbo_refresh_token', '"rt-old"'::jsonb),
           ('qbo_access_token', '"at-old"'::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
      );
      expect(await save(db, "rt-old")).toBe(true);
      const settings = await readSettings(db);
      expect(settings.get("qbo_refresh_token")).toBe("rt-new");
      expect(settings.get("qbo_access_token")).toBe("at-new");
    });
  });

  it("refresh path: CAS miss writes nothing — no torn access/refresh pair", async () => {
    await withTransaction(async (db) => {
      await db.query(
        `INSERT INTO system_settings (key, value) VALUES
           ('qbo_refresh_token', '"rt-winner"'::jsonb),
           ('qbo_access_token', '"at-winner"'::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
      );
      expect(await save(db, "rt-stale")).toBe(false);
      const settings = await readSettings(db);
      expect(settings.get("qbo_refresh_token")).toBe("rt-winner");
      expect(settings.get("qbo_access_token")).toBe("at-winner");
      expect(settings.has("qbo_realm_id")).toBe(false);
    });
  });

  it("refresh path: missing refresh-token row (cleared mid-refresh) is a miss", async () => {
    await withTransaction(async (db) => {
      await db.query("DELETE FROM system_settings WHERE key = 'qbo_refresh_token'");
      expect(await save(db, "rt-old")).toBe(false);
    });
  });

  it("is service_role-only and the 00100 predecessors are gone", async () => {
    await withTransaction(async (db) => {
      const { rows } = await db.query<{ ok: boolean }>(
        `SELECT has_function_privilege('authenticated',
           'save_qbo_tokens_atomic(text,text,text,text,text)', 'EXECUTE') AS ok`
      );
      expect(rows[0]!.ok).toBe(false);
      const { rows: old } = await db.query(
        "SELECT 1 FROM pg_proc WHERE proname IN ('save_qbo_tokens', 'clear_qbo_tokens', 'save_qbo_client_credentials')"
      );
      expect(old).toHaveLength(0);
    });
  });
});
