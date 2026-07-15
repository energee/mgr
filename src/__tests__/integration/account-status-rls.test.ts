/**
 * Account status RLS integration regressions (issue #441).
 *
 * Auth is represented by JWT claims set on a real authenticated Postgres
 * role. Inactive tests therefore model an already-issued access token: the
 * token remains syntactically valid while the database profile is disabled.
 */

import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  SEEDED_UUIDS,
  teardownPool,
  withRoleClient,
} from "./_helpers/role-client";

const CUSTOMER_ID = "00000000-0000-0000-0005-000000000099";
const ORDER_ID = "00000000-0000-0000-0006-000000000099";
const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });

afterAll(async () => {
  await teardownPool();
  await adminPool.end();
});

describe("current_user_is_enabled", () => {
  it.each([
    ["admin", true],
    ["inactive_admin", false],
    ["pending_admin", false],
    ["no_profile", false],
  ] as const)("returns %s => %s", async (role, expected) => {
    await withRoleClient(role, async (db) => {
      const { rows } = await db.query<{ enabled: boolean }>(
        "SELECT current_user_is_enabled() AS enabled",
      );
      expect(rows[0].enabled).toBe(expected);
    });
  });

  it.each(["inactive_admin", "pending_admin", "no_profile"] as const)(
    "makes every role-derived helper fail closed for %s",
    async (role) => {
      await withRoleClient(role, async (db) => {
        const { rows } = await db.query<{
          permission: boolean;
          role_match: boolean;
          primary_role: string | null;
          admin: boolean;
          admin_rls: boolean;
        }>(`
          SELECT
            user_has_permission('users:manage') AS permission,
            user_has_role('admin') AS role_match,
            get_user_role() AS primary_role,
            is_admin() AS admin,
            is_admin_rls(auth.uid()) AS admin_rls
        `);

        expect(rows).toEqual([{
          permission: false,
          role_match: false,
          primary_role: null,
          admin: false,
          admin_rls: false,
        }]);
      });
    },
  );

  it("does not let an authenticated caller probe another user's admin status", async () => {
    await withRoleClient("viewer", async (db) => {
      const { rows } = await db.query<{ admin: boolean }>(
        "SELECT is_admin_rls($1) AS admin",
        [SEEDED_UUIDS.admin],
      );
      expect(rows).toEqual([{ admin: false }]);
    });
  });

  it("does not grant SECURITY DEFINER status helpers to anon", async () => {
    await withRoleClient("admin", async (db) => {
      const { rows } = await db.query<{
        enabled: boolean;
        admin_rls: boolean;
      }>(`
        SELECT
          has_function_privilege('anon', 'public.current_user_is_enabled()', 'EXECUTE') AS enabled,
          has_function_privilege('anon', 'public.is_admin_rls(uuid)', 'EXECUTE') AS admin_rls
      `);
      expect(rows).toEqual([{ enabled: false, admin_rls: false }]);
    });
  });
});

describe("old JWTs fail closed across direct RLS", () => {
  it.each(["inactive_admin", "pending_admin", "no_profile"] as const)(
    "denies domain and broad-policy reads for %s",
    async (role) => {
      await withRoleClient(role, async (db) => {
        expect((await db.query("SELECT * FROM batches LIMIT 1")).rows).toHaveLength(0);
        expect((await db.query("SELECT * FROM system_settings LIMIT 1")).rows).toHaveLength(0);
        expect((await db.query("SELECT * FROM user_profiles LIMIT 1")).rows).toHaveLength(0);
      });
    },
  );

  it("denies direct writes from an inactive admin", async () => {
    await withRoleClient("inactive_admin", async (db) => {
      const result = await db.query(
        "UPDATE system_settings SET updated_at = now() RETURNING key",
      );
      expect(result.rows).toHaveLength(0);
    });
  });

  it("preserves active-admin direct read and write access", async () => {
    await withRoleClient("admin", async (db) => {
      const permission = await db.query<{ allowed: boolean }>(
        "SELECT user_has_permission('users:manage') AS allowed",
      );
      expect(permission.rows[0].allowed).toBe(true);

      const result = await db.query(
        "UPDATE user_profiles SET display_name = display_name WHERE id = $1 RETURNING id",
        [SEEDED_UUIDS.admin],
      );
      expect(result.rows).toEqual([{ id: SEEDED_UUIDS.admin }]);
    });
  });
});

describe("customer policies honor account status", () => {
  it("allows an active portal profile to read its link and order", async () => {
    await withRoleClient("active_customer", async (db) => {
      const links = await db.query(
        "SELECT customer_id FROM customer_portal_users WHERE customer_id = $1",
        [CUSTOMER_ID],
      );
      const orders = await db.query("SELECT id FROM orders WHERE id = $1", [ORDER_ID]);
      expect(links.rows).toEqual([{ customer_id: CUSTOMER_ID }]);
      expect(orders.rows).toEqual([{ id: ORDER_ID }]);
    });
  });

  it("denies the same customer-scoped rows to an inactive old JWT", async () => {
    await withRoleClient("inactive_customer", async (db) => {
      const links = await db.query(
        "SELECT customer_id FROM customer_portal_users WHERE customer_id = $1",
        [CUSTOMER_ID],
      );
      const orders = await db.query("SELECT id FROM orders WHERE id = $1", [ORDER_ID]);
      expect(links.rows).toHaveLength(0);
      expect(orders.rows).toHaveLength(0);
    });
  });
});

describe("user profile authorization fields", () => {
  it("allows an active user to update a legitimate profile field", async () => {
    await withRoleClient("viewer", async (db) => {
      const result = await db.query(
        "UPDATE user_profiles SET display_name = 'Updated Viewer' WHERE id = $1 RETURNING id",
        [SEEDED_UUIDS.viewer],
      );
      expect(result.rows).toEqual([{ id: SEEDED_UUIDS.viewer }]);
    });
  });

  it("blocks self role escalation", async () => {
    await withRoleClient("viewer", async (db) => {
      await expect(
        db.query(
          "UPDATE user_profiles SET roles = ARRAY['admin'] WHERE id = $1",
          [SEEDED_UUIDS.viewer],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("blocks self-reactivation by an inactive old JWT", async () => {
    await withRoleClient("inactive_admin", async (db) => {
      const result = await db.query(
        "UPDATE user_profiles SET status = 'active' WHERE id = $1 RETURNING id",
        [SEEDED_UUIDS.inactive_admin],
      );
      expect(result.rows).toHaveLength(0);
    });
  });

  it("blocks an active admin from bypassing the Auth command for another user's status", async () => {
    await withRoleClient("admin", async (db) => {
      await expect(
        db.query(
          "UPDATE user_profiles SET status = 'inactive' WHERE id = $1",
          [SEEDED_UUIDS.viewer],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("still allows an active admin to manage another user's roles", async () => {
    await withRoleClient("admin", async (db) => {
      const result = await db.query(
        "UPDATE user_profiles SET roles = ARRAY['sales'] WHERE id = $1 RETURNING roles",
        [SEEDED_UUIDS.viewer],
      );
      expect(result.rows).toEqual([{ roles: ["sales"] }]);
    });
  });

  it("keeps account-operation RPCs service-role-only", async () => {
    await withRoleClient("admin", async (db) => {
      await expect(
        db.query(
          "SELECT * FROM begin_user_account_status_operation($1, 'deactivate')",
          [SEEDED_UUIDS.viewer],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });
});

describe("fenced account status operations", () => {
  it("serializes opposite commands and opens RLS only on reactivation completion", async () => {
    const db = await adminPool.connect();
    try {
      await db.query("BEGIN");
      const deactivate = await db.query<{
        operation_id: string;
        profile_status: string;
      }>(
        "SELECT * FROM begin_user_account_status_operation($1, 'deactivate')",
        [SEEDED_UUIDS.admin],
      );
      expect(deactivate.rows[0].profile_status).toBe("active");
      expect(
        (
          await db.query("SELECT status FROM user_profiles WHERE id = $1", [
            SEEDED_UUIDS.admin,
          ])
        ).rows,
      ).toEqual([{ status: "inactive" }]);

      await db.query("SAVEPOINT opposite_command");
      await expect(
        db.query(
          "SELECT * FROM begin_user_account_status_operation($1, 'reactivate')",
          [SEEDED_UUIDS.admin],
        ),
      ).rejects.toMatchObject({ code: "55P03" });
      await db.query("ROLLBACK TO SAVEPOINT opposite_command");

      await db.query(
        "SELECT complete_user_account_status_operation($1, $2)",
        [SEEDED_UUIDS.admin, deactivate.rows[0].operation_id],
      );
      const reactivate = await db.query<{
        operation_id: string;
        profile_status: string;
      }>(
        "SELECT * FROM begin_user_account_status_operation($1, 'reactivate')",
        [SEEDED_UUIDS.admin],
      );
      expect(reactivate.rows[0].profile_status).toBe("inactive");
      expect(
        (
          await db.query("SELECT status FROM user_profiles WHERE id = $1", [
            SEEDED_UUIDS.admin,
          ])
        ).rows,
      ).toEqual([{ status: "inactive" }]);

      await db.query(
        "SELECT complete_user_account_status_operation($1, $2)",
        [SEEDED_UUIDS.admin, reactivate.rows[0].operation_id],
      );
      expect(
        (
          await db.query(
            `SELECT status, account_status_operation_id
             FROM user_profiles WHERE id = $1`,
            [SEEDED_UUIDS.admin],
          )
        ).rows,
      ).toEqual([{ status: "active", account_status_operation_id: null }]);
    } finally {
      await db.query("ROLLBACK");
      db.release();
    }
  });
});

describe("enabled-account policy inventory", () => {
  it("adds an authenticated restrictive gate to every public RLS table", async () => {
    await withRoleClient("admin", async (db) => {
      const { rows } = await db.query<{ table_name: string }>(`
        SELECT c.relname AS table_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p')
          AND c.relrowsecurity
          AND NOT EXISTS (
            SELECT 1
            FROM pg_policies p
            WHERE p.schemaname = 'public'
              AND p.tablename = c.relname
              AND p.policyname = 'current_user_enabled'
              AND p.permissive = 'RESTRICTIVE'
              AND 'authenticated' = ANY(p.roles)
              AND p.qual LIKE '%current_user_is_enabled%'
              AND p.with_check LIKE '%current_user_is_enabled%'
          )
        ORDER BY c.relname
      `);
      expect(rows).toEqual([]);
    });
  });
});
