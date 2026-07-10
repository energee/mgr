/**
 * RLS Policy Coverage — Tasks 2–6 of the RLS coverage-gap plan.
 *
 * Schema-level assertions: for each table whose policy was tightened in
 * migrations 00193–00197 (plus square_locations, tightened in 00231), this
 * test queries `pg_policies` and verifies that
 * the SELECT and write policies exist with `user_has_permission(...)` (or
 * the catalog-pattern `auth.uid() IS NOT NULL`) in the qual/with_check,
 * and that no `USING (true)` / `WITH CHECK (true)` policies remain.
 *
 * Schema-level checks are preferred here because each table is empty in CI
 * — behavioral assertions ("admin can SELECT") would be vacuous (zero rows
 * returned either way). The pg_policies query confirms the policy DEFINITION
 * is what we expect, independent of data. Behavioral fail-closed coverage
 * lives in `rls-fail-closed.test.ts` (and is extended by Task 8's
 * `pg_policies` guardrail when it lands).
 *
 * Run locally:   DATABASE_URL=... bun run test:integration
 * Run in CI:     see .github/workflows/test.yml — integration-tests job.
 */

import { afterAll, describe, expect, it } from "vitest";
import { teardownPool, withRoleClient } from "./_helpers/role-client";

interface Expectation {
  table: string;
  selectQualContains: string;
  writeQualContains: string;
  writeCheckContains: string;
  /**
   * True for tables that exist only in the live database (created out-of-band,
   * no CREATE TABLE in any migration). A migrations-built CI database does not
   * have them, so the expectation passes vacuously when the table is absent.
   */
  liveDbOnly?: boolean;
}

const EXPECTATIONS: Expectation[] = [
  // Task 2 — yeast_pitch_events (batches domain)
  {
    table: "yeast_pitch_events",
    selectQualContains: "batches:read",
    writeQualContains: "batches:write",
    writeCheckContains: "batches:write",
  },
  // Task 3 — selling_format_materials (catalog)
  {
    table: "selling_format_materials",
    selectQualContains: "auth.uid",
    writeQualContains: "settings:manage",
    writeCheckContains: "settings:manage",
  },
  // Task 4 — four 00162 tables
  {
    table: "brewery_shipping_defaults",
    selectQualContains: "auth.uid",
    writeQualContains: "settings:manage",
    writeCheckContains: "settings:manage",
  },
  {
    table: "customer_shipping_materials",
    selectQualContains: "customers:read",
    writeQualContains: "customers:write",
    writeCheckContains: "customers:write",
  },
  {
    table: "customer_pallet_configs",
    selectQualContains: "customers:read",
    writeQualContains: "customers:write",
    writeCheckContains: "customers:write",
  },
  {
    table: "order_materials",
    selectQualContains: "orders:read",
    writeQualContains: "orders:write",
    writeCheckContains: "orders:write",
  },
  // Task 5 — mongodb sync (settings:manage everywhere)
  {
    table: "mongodb_sync_log",
    selectQualContains: "settings:manage",
    writeQualContains: "settings:manage",
    writeCheckContains: "settings:manage",
  },
  {
    table: "mongodb_sync_mappings",
    selectQualContains: "settings:manage",
    writeQualContains: "settings:manage",
    writeCheckContains: "settings:manage",
  },
  // Task 6 — legacy audit findings.
  // (keg_inventory is intentionally absent: it has been a VIEW since 00032 —
  // drift-captured in 00191 with security_invoker = true — so the underlying
  // kegs/keg_transactions RLS applies and no policy can exist on it.)
  {
    table: "water_addition_profiles",
    selectQualContains: "auth.uid",
    writeQualContains: "settings:manage",
    writeCheckContains: "settings:manage",
    liveDbOnly: true,
  },
  // 00231 — square_locations: SELECT tightened from staff-wide
  // (auth.uid() IS NOT NULL, 00222) to inventory:read so production_manager
  // keeps the bin-form Square Location picker while the portal customer role
  // is excluded. Writes stay integrations:manage (00222).
  {
    table: "square_locations",
    selectQualContains: "inventory:read",
    writeQualContains: "integrations:manage",
    writeCheckContains: "integrations:manage",
  },
];

afterAll(async () => {
  await teardownPool();
});

describe("RLS policy coverage — Tasks 2–6", () => {
  it.each(EXPECTATIONS)(
    "$table has properly scoped SELECT and write policies",
    async ({ table, selectQualContains, writeQualContains, writeCheckContains, liveDbOnly }) => {
      // admin can read pg_policies — it's a system view, not RLS-gated, but
      // we use admin to be explicit about the test identity.
      await withRoleClient("admin", async (db) => {
        if (liveDbOnly) {
          const { rows: reg } = await db.query<{ oid: string | null }>(
            `SELECT to_regclass('public.' || quote_ident($1))::text AS oid`,
            [table],
          );
          if (reg[0]?.oid === null) {
            // Live-DB-only table absent here (migration 00197 guards it with
            // to_regclass); nothing to assert against.
            return;
          }
        }
        const { rows } = await db.query<{
          policyname: string;
          cmd: string;
          qual: string | null;
          with_check: string | null;
        }>(
          `SELECT policyname, cmd, qual, with_check
             FROM pg_policies
            WHERE schemaname = 'public' AND tablename = $1`,
          [table],
        );

        expect(rows.length, `${table} should have at least one policy`).toBeGreaterThan(
          0,
        );

        // No policy may use plain USING (true) or WITH CHECK (true) anymore.
        for (const r of rows) {
          if (r.qual !== null) {
            expect(r.qual.trim()).not.toBe("true");
          }
          if (r.with_check !== null) {
            expect(r.with_check.trim()).not.toBe("true");
          }
        }

        // SELECT policy must reference the expected permission/catalog gate.
        const selectPolicies = rows.filter((r) => r.cmd === "SELECT" || r.cmd === "ALL");
        const selectQuals = selectPolicies.map((r) => r.qual ?? "").join(" || ");
        expect(
          selectQuals,
          `${table} SELECT policy should reference ${selectQualContains}`,
        ).toContain(selectQualContains);

        // Write-capable policy (FOR ALL or FOR INSERT/UPDATE/DELETE) must
        // reference the expected write permission in both qual and with_check.
        const writePolicies = rows.filter(
          (r) => r.cmd === "ALL" || r.cmd === "INSERT" || r.cmd === "UPDATE" || r.cmd === "DELETE",
        );
        expect(writePolicies.length, `${table} should have a write policy`).toBeGreaterThan(
          0,
        );
        const writeQuals = writePolicies.map((r) => r.qual ?? "").join(" || ");
        const writeChecks = writePolicies.map((r) => r.with_check ?? "").join(" || ");
        expect(writeQuals, `${table} write qual`).toContain(writeQualContains);
        expect(writeChecks, `${table} write check`).toContain(writeCheckContains);
      });
    },
    15_000,
  );
});
