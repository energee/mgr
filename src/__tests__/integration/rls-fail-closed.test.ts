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
 * and the fixtures from `_fixtures/seed-roles.sql` seeded. Authentication is
 * simulated by `SET LOCAL request.jwt.claims` on a pg connection (see
 * `_helpers/role-client.ts`) — no GoTrue or PostgREST required.
 *
 * Run locally:   DATABASE_URL=... bun run test:integration
 * Run in CI:     see .github/workflows/test.yml — integration-tests job.
 */

import { afterAll, describe, expect, it } from "vitest";
import { teardownPool, withRoleClient } from "./_helpers/role-client";

/**
 * Representative sample of domain tables that must be protected by RLS.
 * Tasks 2–6 add per-table coverage; this test is specifically about the
 * fail-closed contract: no-roles and no-profile users MUST be denied on all
 * of these regardless of future policy changes.
 */
const DOMAIN_TABLES = [
  "batches",
  "recipes",
  "orders",
  "customers",
  "inventory_items",
  "purchase_orders",
] as const;

afterAll(async () => {
  await teardownPool();
});

describe("RLS fail-closed — empty roles array", () => {
  it.each(DOMAIN_TABLES)(
    "denies SELECT on %s for a user with roles=[]",
    async (table) => {
      await withRoleClient("no_roles", async (db) => {
        // SELECT under RLS as the no_roles user. user_has_permission('<dom>:read')
        // returns false for every domain, so the result must be zero rows.
        // We don't expect an error — RLS filters silently.
        const { rows } = await db.query(`SELECT * FROM ${table} LIMIT 1`);
        expect(rows).toHaveLength(0);
      });
    },
    15_000,
  );
});

describe("RLS fail-closed — missing user_profiles row", () => {
  it.each(DOMAIN_TABLES)(
    "denies SELECT on %s for an auth user with no user_profiles row",
    async (table) => {
      await withRoleClient("no_profile", async (db) => {
        const { rows } = await db.query(`SELECT * FROM ${table} LIMIT 1`);
        expect(rows).toHaveLength(0);
      });
    },
    15_000,
  );
});
