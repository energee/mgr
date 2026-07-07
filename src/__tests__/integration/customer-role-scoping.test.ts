/**
 * Customer role & notification scoping — migration 00201 (audit C1/H9).
 *
 * Schema-level assertions on function definitions, following the
 * rls-policy-coverage pattern: the CI database is built from migrations, so
 * `pg_get_functiondef` reflects exactly what 00201 installed. Behavioral
 * trigger tests (inserting into auth.users) are not possible here because
 * the seeded role clients run as `authenticated`, not superuser.
 *
 * Guards:
 * - `create_user_profile()` assigns the customer role on a case-insensitive
 *   active-customer email match (regression: 00097 lost this and portal
 *   invitees got the staff 'viewer' role).
 * - `notify_all_users()` iterates active non-customer user_profiles, NOT
 *   auth.users (regression: portal customers received staff broadcasts
 *   embedding other customers' names and order numbers).
 * - 'customer' grants no staff permission via get_roles_for_permission().
 *
 * Run locally:   DATABASE_URL=... bun run test:integration
 * Run in CI:     see .github/workflows/test.yml — integration-tests job.
 */

import { afterAll, describe, expect, it } from "vitest";
import { teardownPool, withRoleClient } from "./_helpers/role-client";

afterAll(async () => {
  await teardownPool();
});

/** Fetch the single public-schema definition of a function by name. */
async function getFunctionDef(name: string): Promise<string> {
  return withRoleClient("admin", async (db) => {
    const { rows } = await db.query<{ def: string }>(
      `SELECT pg_get_functiondef(oid) AS def
         FROM pg_proc
        WHERE proname = $1 AND pronamespace = 'public'::regnamespace`,
      [name],
    );
    expect(rows.length, `${name} should exist exactly once`).toBe(1);
    return rows[0].def;
  });
}

describe("create_user_profile — customer role assignment (00201, audit C1)", () => {
  it("matches customer emails case-insensitively and assigns the customer role", async () => {
    const def = await getFunctionDef("create_user_profile");
    expect(def).toContain("lower(c.email) = lower(NEW.email)");
    expect(def).toContain("ARRAY['customer']");
    // Only active customer records qualify.
    expect(def).toContain("COALESCE(c.is_active, true)");
  });

  it("keeps first-user-admin bootstrap and the viewer default", async () => {
    const def = await getFunctionDef("create_user_profile");
    expect(def).toContain("ARRAY['admin']");
    expect(def).toContain("ARRAY['viewer']");
    // Upsert semantics preserved: existing profiles keep their roles.
    expect(def).toContain("ON CONFLICT (id) DO UPDATE");
  });
});

describe("notify_all_users — staff-only recipients (00201, audit H9)", () => {
  it("iterates active non-customer user_profiles, not auth.users", async () => {
    const def = await getFunctionDef("notify_all_users");
    expect(def).toContain("FROM user_profiles");
    expect(def).toContain("status = 'active'");
    expect(def).toContain("NOT ('customer' = ANY(roles))");
    expect(def).not.toContain("FROM auth.users");
  });
});

describe("customer role — empty staff permission set", () => {
  it("get_roles_for_permission never includes 'customer' for any staff permission", async () => {
    await withRoleClient("admin", async (db) => {
      const permissions = [
        "recipes:read", "recipes:write", "batches:read", "batches:write",
        "orders:read", "orders:write", "customers:read", "customers:write",
        "inventory:read", "inventory:write", "purchasing:read", "purchasing:write",
        "vessels:read", "vessels:write", "integrations:manage",
        "settings:manage", "users:manage",
      ];
      for (const permission of permissions) {
        const { rows } = await db.query<{ allowed: string[] }>(
          `SELECT get_roles_for_permission($1) AS allowed`,
          [permission],
        );
        expect(
          rows[0].allowed,
          `'customer' must not hold staff permission ${permission}`,
        ).not.toContain("customer");
      }
    });
  });
});
