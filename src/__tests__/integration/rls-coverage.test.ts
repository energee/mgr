/**
 * RLS Coverage Guardrail — Task 8 of the RLS coverage-gap plan.
 *
 * Fails when any policy in `public` is permissive at the row-filter level
 * (USING / WITH CHECK is `true` or `auth.uid() IS NOT NULL`) but lacks a
 * `COMMENT ON POLICY ... IS 'RLS-EXCEPTION: <reason>'` marker.
 *
 * Why per-policy comments instead of an allowlist file:
 *   - Allowlist files rot silently. A migration can drop the policy without
 *     touching the allowlist, and CI keeps passing.
 *   - Comments live next to the policy. If the policy is dropped or renamed,
 *     the comment goes with it, and any replacement permissive policy
 *     immediately fails this test until a new comment is added.
 *
 * What counts as a permissive policy here:
 *   - qual is literally `true`, OR
 *   - qual is `auth.uid() IS NOT NULL` in either canonical form:
 *       - direct:   `(auth.uid() IS NOT NULL)`
 *       - initplan: `(( SELECT auth.uid() AS uid) IS NOT NULL)`
 *         (this is the Supabase-recommended init-plan optimization; semantics
 *          are identical to the direct form — "any authenticated user")
 *   - or either of the above for with_check.
 *
 *   Both forms are flagged because they are semantically the same wholesale
 *   bypass of role-based authorization. Detecting only the direct form would
 *   let new permissive policies sneak past the guardrail by formatting alone.
 *
 *   Subquery-based predicates (e.g. `EXISTS (SELECT ... user_profiles ...)`)
 *   and column-comparison predicates (e.g. `user_id = auth.uid()`) are NOT
 *   permissive and are not flagged.
 *
 * What an `RLS-EXCEPTION:` comment should explain:
 *   - Why bypassing role authorization is correct for THIS policy.
 *   - Which permission boundary still protects the row (e.g. "append-only
 *     audit log, all authenticated users may insert; read is gated elsewhere").
 *
 * Run locally:   DATABASE_URL=... bun run test:integration
 * Run in CI:     see .github/workflows/test.yml — integration-tests job.
 */

import { afterAll, describe, expect, it } from "vitest";
import { teardownPool, withRoleClient } from "./_helpers/role-client";

/**
 * Canonical row-filter expressions that count as permissive after normalizing
 * the Supabase init-plan wrapper `( SELECT auth.uid() AS uid)` back to
 * `auth.uid()`. The normalization happens in the SQL query below so both
 * `(auth.uid() IS NOT NULL)` and `(( SELECT auth.uid() AS uid) IS NOT NULL)`
 * collapse to the same form before comparison.
 */
const PERMISSIVE_QUALS = ["true", "(auth.uid() IS NOT NULL)"] as const;

/** Required prefix on the `COMMENT ON POLICY` text for a documented exception. */
const EXCEPTION_PREFIX = "RLS-EXCEPTION:";

type PermissivePolicyRow = {
  tablename: string;
  policyname: string;
  cmd: string;
  qual: string | null;
  with_check: string | null;
  comment: string | null;
}

afterAll(async () => {
  await teardownPool();
});

describe("RLS coverage guardrail — permissive policies must carry an RLS-EXCEPTION comment", () => {
  it("every permissive policy in public has a COMMENT ON POLICY starting with 'RLS-EXCEPTION:'", async () => {
    // Admin role is used only because we need to read pg_policies / pg_description
    // (system catalogs). The query reads metadata, not row data, so the choice of
    // identity does not affect the result; admin makes the intent obvious.
    await withRoleClient("admin", async (db) => {
      const { rows } = await db.query<PermissivePolicyRow>(
        `
        WITH normalized AS (
          SELECT
            p.tablename,
            p.policyname,
            p.cmd,
            p.qual,
            p.with_check,
            -- Normalize the init-plan wrapper "( SELECT auth.uid() AS uid)"
            -- back to "auth.uid()" so the direct and init-plan forms collapse.
            trim(
              regexp_replace(
                coalesce(p.qual, ''),
                '\\(\\s*SELECT\\s+auth\\.uid\\(\\)\\s+AS\\s+\\w+\\s*\\)',
                'auth.uid()',
                'gi'
              )
            ) AS qual_norm,
            trim(
              regexp_replace(
                coalesce(p.with_check, ''),
                '\\(\\s*SELECT\\s+auth\\.uid\\(\\)\\s+AS\\s+\\w+\\s*\\)',
                'auth.uid()',
                'gi'
              )
            ) AS with_check_norm,
            pol.oid AS policy_oid,
            p.schemaname
          FROM pg_policies p
          JOIN pg_class c
            ON c.relname = p.tablename
           AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = p.schemaname)
          JOIN pg_policy pol
            ON pol.polname = p.policyname AND pol.polrelid = c.oid
          WHERE p.schemaname = 'public'
        )
        SELECT
          n.tablename,
          n.policyname,
          n.cmd,
          n.qual,
          n.with_check,
          pd.description AS comment
        FROM normalized n
        LEFT JOIN pg_description pd
          ON pd.objoid = n.policy_oid AND pd.classoid = 'pg_policy'::regclass
        WHERE n.qual_norm       = ANY($1::text[])
           OR n.with_check_norm = ANY($1::text[])
        ORDER BY n.tablename, n.policyname
        `,
        [PERMISSIVE_QUALS],
      );

      const undocumented = rows.filter(
        (r) =>
          !r.comment || !r.comment.trim().startsWith(EXCEPTION_PREFIX),
      );

      const detail = undocumented
        .map(
          (r) =>
            `  - ${r.tablename}.${r.policyname} (${r.cmd}) ` +
            `qual=${JSON.stringify(r.qual)} with_check=${JSON.stringify(r.with_check)}`,
        )
        .join("\n");

      expect(
        undocumented,
        `Permissive policies must carry COMMENT ON POLICY <name> ON <table> ` +
          `IS '${EXCEPTION_PREFIX} <reason>'. Found ${undocumented.length} ` +
          `undocumented permissive policies:\n${detail}\n` +
          `If the permissive policy is intentional (e.g. append-only audit log), ` +
          `add a migration that comments it with an explanation. If it is a ` +
          `mistake, tighten the policy to use user_has_permission(...).`,
      ).toEqual([]);
    });
  }, 15_000);
});
