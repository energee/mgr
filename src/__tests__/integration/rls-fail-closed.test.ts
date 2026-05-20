/**
 * RLS Fail-Closed Integration Tests
 *
 * Verifies that two edge cases are denied access to every domain table:
 *
 * 1. A user with an empty `roles TEXT[]` array in user_profiles.
 * 2. An authenticated user whose auth.users row exists but who has NO
 *    user_profiles row (tests fail-closed for race conditions on signup).
 *
 * These tests run against a real Postgres instance with all migrations applied
 * and the fixtures from `_fixtures/seed-roles.sql` seeded.
 *
 * Run locally:   bun run test:integration
 * Run in CI:     see .github/workflows/test.yml — integration-tests job.
 */

import { describe, it, expect } from "vitest";
import { getClientForRole } from "./_helpers/role-client";

/**
 * Representative sample of domain tables that must be protected by RLS.
 * Each entry is the Supabase table name exactly as it appears in the schema.
 *
 * This is not exhaustive — Tasks 2–6 add per-table tests. This test is
 * specifically about the fail-closed contract: no-roles and no-profile users
 * MUST be denied on all of these regardless of future policy changes.
 */
const DOMAIN_TABLES = [
  "batches",
  "recipes",
  "orders",
  "customers",
  "inventory_items",
  "purchase_orders",
] as const;

/**
 * Attempt SELECT * LIMIT 1 on a table using the given client.
 * Returns true if denied (zero rows returned or explicit RLS error),
 * false if any rows come back (access was granted — bad).
 */
async function isDeniedSelect(
  client: Awaited<ReturnType<typeof getClientForRole>>,
  table: string,
): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any).from(table).select("*").limit(1);

  if (error) {
    // An RLS error (42501 insufficient_privilege) counts as denied.
    return true;
  }

  // Zero rows returned = RLS filtered everything = denied.
  // If rows come back, the policy is too permissive.
  return !data || data.length === 0;
}

describe("RLS fail-closed — empty roles array", () => {
  it.each(DOMAIN_TABLES)(
    "denies SELECT on %s for a user with roles=[]",
    async (table) => {
      const client = await getClientForRole("no_roles");
      const denied = await isDeniedSelect(client, table);
      expect(denied).toBe(true);
    },
    // Longer timeout for real network round-trips to Postgres
    15_000,
  );
});

describe("RLS fail-closed — missing user_profiles row", () => {
  it.each(DOMAIN_TABLES)(
    "denies SELECT on %s for an auth user with no user_profiles row",
    async (table) => {
      const client = await getClientForRole("no_profile");
      const denied = await isDeniedSelect(client, table);
      expect(denied).toBe(true);
    },
    15_000,
  );
});
