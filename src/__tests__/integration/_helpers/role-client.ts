/**
 * Role-based Supabase client helper for integration tests.
 *
 * Returns a Supabase client authenticated as a seeded test user for a given
 * role tier. RLS policies are evaluated against the user's JWT, so these
 * clients exercise real row-level security (unlike the service-role client).
 *
 * Approach: signInWithPassword against seeded auth.users rows.
 *
 * Alternative (if signInWithPassword is unavailable — e.g. GoTrue not running):
 *   Sign a JWT manually using the Supabase JWT secret from `supabase status`
 *   or SUPABASE_JWT_SECRET env var, then call:
 *     createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
 *   The JWT payload must include { sub: <user-uuid>, role: "authenticated" }.
 *
 * Seeded users are defined in `_fixtures/seed-roles.sql`.
 * All use password: "test-password-123!"
 */

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

/** Role tiers available as seeded test users. */
export type SeededRole =
  | "viewer"
  | "inventory_manager"
  | "production_manager"
  | "admin"
  | "no_roles"
  | "no_profile";

/** Credentials for each seeded role tier. */
const SEEDED_USERS: Record<SeededRole, { email: string; uuid: string }> = {
  viewer: {
    email: "viewer@test.local",
    uuid: "00000000-0000-0000-0000-000000000001",
  },
  inventory_manager: {
    // Seeded with roles=['production_manager'] — has inventory:write permission.
    // The email is 'inventory-manager@test.local'; the SeededRole label is
    // 'inventory_manager' for readability in test code.
    email: "inventory-manager@test.local",
    uuid: "00000000-0000-0000-0000-000000000002",
  },
  production_manager: {
    email: "production-manager@test.local",
    uuid: "00000000-0000-0000-0000-000000000003",
  },
  admin: {
    email: "admin@test.local",
    uuid: "00000000-0000-0000-0000-000000000004",
  },
  no_roles: {
    // auth.users row exists; user_profiles row has roles=[]
    email: "no-roles@test.local",
    uuid: "00000000-0000-0000-0000-000000000005",
  },
  no_profile: {
    // auth.users row exists; NO user_profiles row — tests fail-closed behavior
    email: "no-profile@test.local",
    uuid: "00000000-0000-0000-0000-000000000006",
  },
};

const TEST_PASSWORD = "test-password-123!";

function getRequiredEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(
      `Integration test requires env var ${key}. ` +
        `Run 'supabase start' and set SUPABASE_URL + SUPABASE_ANON_KEY, ` +
        `or set INTEGRATION_SUPABASE_URL + INTEGRATION_SUPABASE_ANON_KEY.`,
    );
  }
  return val;
}

/**
 * Returns a Supabase client authenticated as a seeded test user with the
 * given role tier. RLS policies apply — this is NOT a service-role client.
 *
 * @param role - One of the seeded role tiers.
 * @returns An authenticated SupabaseClient<Database>.
 * @throws If the Supabase URL/anon key env vars are not set, or if sign-in fails.
 */
export async function getClientForRole(
  role: SeededRole,
): Promise<SupabaseClient<Database>> {
  const url = process.env.INTEGRATION_SUPABASE_URL ?? getRequiredEnv("SUPABASE_URL");
  const anonKey =
    process.env.INTEGRATION_SUPABASE_ANON_KEY ?? getRequiredEnv("SUPABASE_ANON_KEY");

  const user = SEEDED_USERS[role];

  const client = createClient<Database>(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { error } = await client.auth.signInWithPassword({
    email: user.email,
    password: TEST_PASSWORD,
  });

  if (error) {
    throw new Error(
      `Failed to sign in as seeded '${role}' user (${user.email}): ${error.message}. ` +
        `Ensure seed-roles.sql has been applied and GoTrue is running.`,
    );
  }

  return client;
}

/** The deterministic UUID for each seeded role, for use in assertions. */
export const SEEDED_UUIDS = Object.fromEntries(
  Object.entries(SEEDED_USERS).map(([role, u]) => [role, u.uuid]),
) as Record<SeededRole, string>;
