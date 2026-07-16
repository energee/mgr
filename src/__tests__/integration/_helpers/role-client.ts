/**
 * Role-based pg client helper for integration tests.
 *
 * Returns a `pg` PoolClient whose session is configured to behave as if it
 * were an authenticated Supabase user with a chosen role. This lets RLS
 * policies that depend on `auth.uid()` and `user_has_permission(...)` evaluate
 * exactly as they would in production — without requiring GoTrue or
 * PostgREST in CI.
 *
 * ## Why direct pg + SET LOCAL instead of Supabase JS + signInWithPassword?
 *
 * `signInWithPassword` requires GoTrue. Adding GoTrue to the CI Postgres-only
 * stack (see `.github/workflows/test.yml`) would mean another container,
 * another healthcheck, and a heavier image pull on every run. The
 * Supabase-idiomatic alternative for RLS testing is to set
 * `request.jwt.claims` directly on the session:
 *
 *   SET LOCAL ROLE authenticated;
 *   SET LOCAL request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
 *
 * After that, `auth.uid()` (which Supabase implements via
 * `current_setting('request.jwt.claims', true)::jsonb ->> 'sub'`) returns the
 * UUID we set, and `user_has_permission(...)` evaluates against the seeded
 * `user_profiles` row. RLS applies normally.
 *
 * ## Transaction discipline
 *
 * `SET LOCAL` only persists within a transaction. The helper opens a
 * transaction before returning the client. Callers MUST end the transaction
 * (via `ROLLBACK` or `COMMIT`) and release the client. Use `withRoleClient`
 * to handle this automatically.
 *
 * Seeded users are defined in `_fixtures/seed-roles.sql`.
 */

import { Pool, type PoolClient } from "pg";

/** Role tiers available as seeded test users. */
export type SeededRole =
  | "viewer"
  | "inventory_manager"
  | "production_manager"
  | "sales"
  | "admin"
  | "no_roles"
  | "no_profile"
  | "inactive_admin"
  | "pending_admin"
  | "active_customer"
  | "inactive_customer";

/** Deterministic UUIDs for each seeded role tier. See `_fixtures/seed-roles.sql`. */
export const SEEDED_UUIDS: Record<SeededRole, string> = {
  viewer: "00000000-0000-0000-0000-000000000001",
  // inventory_manager is seeded with roles=['production_manager'] because the
  // production_manager role carries inventory:write in the permission map.
  inventory_manager: "00000000-0000-0000-0000-000000000002",
  production_manager: "00000000-0000-0000-0000-000000000003",
  sales: "00000000-0000-0000-0000-000000000011",
  admin: "00000000-0000-0000-0000-000000000004",
  // auth.users row exists; user_profiles row has roles=[]
  no_roles: "00000000-0000-0000-0000-000000000005",
  // auth.users row exists; NO user_profiles row — tests fail-closed behavior
  no_profile: "00000000-0000-0000-0000-000000000006",
  inactive_admin: "00000000-0000-0000-0000-000000000007",
  pending_admin: "00000000-0000-0000-0000-000000000008",
  active_customer: "00000000-0000-0000-0000-000000000009",
  inactive_customer: "00000000-0000-0000-0000-000000000010",
};

let pool: Pool | undefined;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "Integration tests require DATABASE_URL. Set it to a Postgres URL " +
          "with all migrations + seed-roles.sql applied.",
      );
    }
    pool = new Pool({ connectionString, max: 4 });
  }
  return pool;
}

/**
 * Acquire a pg client with `request.jwt.claims` set to impersonate the given
 * role's seeded user. Opens a transaction before returning.
 *
 * CALLER MUST end the transaction (ROLLBACK / COMMIT) and release the client.
 * Prefer `withRoleClient` to handle this automatically.
 */
export async function getClientForRole(role: SeededRole): Promise<PoolClient> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: SEEDED_UUIDS[role], role: "authenticated" }),
    ]);
    return client;
  } catch (err) {
    // If setup fails, release immediately so the pool isn't leaked.
    client.release();
    throw err;
  }
}

/**
 * Convenience wrapper: acquires a role-impersonated client, runs `fn`, then
 * ROLLBACKs and releases. Use this for read-only tests so writes can't leak.
 */
export async function withRoleClient<T>(
  role: SeededRole,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getClientForRole(role);
  try {
    return await fn(client);
  } finally {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Best-effort; transaction may already be aborted.
    }
    client.release();
  }
}

/** Tear down the shared pool. Call from a global teardown / afterAll. */
export async function teardownPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
