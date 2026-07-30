/**
 * entity_revisions read authorization — migration 00275 (issue #604).
 *
 * `entity_revisions` is the unified audit trail. `log_entity_revision()`
 * persists complete `to_jsonb()` row images of ten tracked business tables,
 * so the audit row is a second copy of the source row — not a reference to
 * it. Before 00275 the only SELECT policy was `auth.uid() IS NOT NULL`, so
 * any authenticated principal (including a portal customer, whose staff
 * permission set is deliberately empty) could read every order, recipe,
 * purchase order and pricing row through the audit table.
 *
 * 00275 replaces that policy with a CASE over `entity_type` that requires the
 * same permission the tracked table's own SELECT policy requires, and falls
 * back to `settings:manage` (admin-only) for any entity_type not enumerated
 * — so a table that gains the trigger later fails closed instead of silently
 * widening exposure.
 *
 * These are behavioral assertions, not schema-text assertions: fixture
 * revision rows are committed by an owner connection (RLS-exempt), then read
 * back through role-impersonated `authenticated` sessions so the policy
 * actually evaluates.
 *
 * Run locally:   DATABASE_URL=... bun run test:integration
 * Run in CI:     see .github/workflows/db-lint.yml — integration tests step.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  teardownPool,
  withRoleClient,
  type SeededRole,
} from "./_helpers/role-client";

/** Marks the rows this spec inserts so assertions ignore seed/demo revisions. */
const FIXTURE_MARKER = "issue-604-entity-revisions-rls";

/**
 * One fixture revision per tracked `entity_type`, plus a deliberately
 * unknown type that no CASE branch enumerates (the fail-closed probe).
 * The UUID suffix is the index; values are arbitrary but deterministic.
 */
const FIXTURE_ENTITY_TYPES = [
  "orders",
  "recipes",
  "batches",
  "purchase_orders",
  // Gained the revision trigger in 00282 (#549); its CASE branch mirrors
  // supplier_catalog_select -> purchasing:read.
  "supplier_catalog",
  "finished_goods",
  "inventory_lots",
  "keg_transactions",
  "packaging_sessions",
  "allocations",
  "pricing_tier_prices",
  // Also gained the trigger in 00282. Its branch is settings:manage, NOT a
  // mirror of enum_values_select (`auth.uid() IS NOT NULL`) — mirroring that
  // literally would let portal customers read the row images, which is the
  // hole 00275 closed. Same call 00275 made for pricing_tier_prices.
  "enum_values",
  // Not enumerated by the policy: stands in for a table that gains the
  // revision trigger in a future migration without a matching CASE branch.
  "future_untracked_table",
] as const;

type FixtureEntityType = (typeof FIXTURE_ENTITY_TYPES)[number];

/**
 * Expected visibility per seeded role, derived from the permission each
 * tracked table's own SELECT policy requires:
 *
 *   orders              -> orders:read
 *   recipes             -> recipes:read
 *   batches             -> batches:read
 *   purchase_orders     -> purchasing:read
 *   supplier_catalog    -> purchasing:read
 *   finished_goods      -> inventory:read
 *   inventory_lots      -> inventory:read
 *   keg_transactions    -> inventory:read
 *   packaging_sessions  -> batches:read
 *   allocations         -> inventory:read
 *   pricing_tier_prices -> settings:manage
 *   enum_values         -> settings:manage
 *   (anything else)     -> settings:manage
 *
 * The two settings tables are the exception to "the permission the tracked
 * table's own SELECT policy requires": both `pricing_tier_prices_select` and
 * `enum_values_select` admit any authenticated principal, and a portal
 * customer is authenticated, so the revision rows are gated on settings:manage
 * instead. See the 00282 header.
 *
 * Role -> permission comes from `get_roles_for_permission()` (00266):
 * `viewer` holds purchasing:read but not settings:manage; `sales` holds
 * neither; `customer` holds nothing at all.
 */
const EXPECTED_VISIBLE: Record<string, readonly FixtureEntityType[]> = {
  admin: FIXTURE_ENTITY_TYPES,
  viewer: [
    "orders",
    "recipes",
    "batches",
    "purchase_orders",
    "supplier_catalog",
    "finished_goods",
    "inventory_lots",
    "keg_transactions",
    "packaging_sessions",
    "allocations",
  ],
  sales: [
    "orders",
    "recipes",
    "batches",
    "finished_goods",
    "inventory_lots",
    "keg_transactions",
    "packaging_sessions",
    "allocations",
  ],
  active_customer: [],
  no_roles: [],
};

/** Owner connection: RLS-exempt, used only to commit and remove fixtures. */
const ownerPool = new Pool({ connectionString: process.env.DATABASE_URL });

function fixtureEntityId(index: number): string {
  return `00000000-0000-0000-0604-${String(index).padStart(12, "0")}`;
}

beforeAll(async () => {
  await ownerPool.query(
    `DELETE FROM entity_revisions WHERE change_reason = $1`,
    [FIXTURE_MARKER],
  );
  for (const [index, entityType] of FIXTURE_ENTITY_TYPES.entries()) {
    await ownerPool.query(
      `INSERT INTO entity_revisions
         (entity_type, entity_id, revision_number, operation, new_data, change_reason)
       VALUES ($1, $2, 1, 'INSERT', $3::jsonb, $4)`,
      [
        entityType,
        fixtureEntityId(index),
        JSON.stringify({ secret: `${entityType} row image` }),
        FIXTURE_MARKER,
      ],
    );
  }
});

afterAll(async () => {
  await ownerPool.query(
    `DELETE FROM entity_revisions WHERE change_reason = $1`,
    [FIXTURE_MARKER],
  );
  await ownerPool.end();
  await teardownPool();
});

/** Entity types among the fixtures that `role` can actually SELECT. */
async function visibleFixtureTypes(role: SeededRole): Promise<string[]> {
  return withRoleClient(role, async (db) => {
    const { rows } = await db.query<{ entity_type: string }>(
      `SELECT entity_type FROM entity_revisions
        WHERE change_reason = $1
        ORDER BY entity_type`,
      [FIXTURE_MARKER],
    );
    return rows.map((r) => r.entity_type);
  });
}

describe("entity_revisions SELECT is gated by the tracked table's permission (#604)", () => {
  it.each(Object.keys(EXPECTED_VISIBLE) as SeededRole[])(
    "%s sees exactly the revisions its permissions allow",
    async (role) => {
      const visible = await visibleFixtureTypes(role);
      expect(visible.sort()).toEqual([...EXPECTED_VISIBLE[role]].sort());
    },
  );

  it("a customer-role session reads ZERO rows from entity_revisions", async () => {
    await withRoleClient("active_customer", async (db) => {
      const { rows } = await db.query<{ total: string }>(
        "SELECT count(*)::text AS total FROM entity_revisions",
      );
      expect(rows[0].total).toBe("0");
    });
  });

  it("an unknown entity_type is readable only by admin (fails closed)", async () => {
    for (const role of ["viewer", "sales", "active_customer"] as const) {
      const visible = await visibleFixtureTypes(role);
      expect(visible, `${role} must not read an unenumerated entity_type`)
        .not.toContain("future_untracked_table");
    }
    expect(await visibleFixtureTypes("admin")).toContain(
      "future_untracked_table",
    );
  });

  it("staff denied a tracked table cannot read its revisions", async () => {
    // sales holds no purchasing:read and no settings:manage.
    const salesVisible = await visibleFixtureTypes("sales");
    expect(salesVisible).not.toContain("purchase_orders");
    expect(salesVisible).not.toContain("supplier_catalog");
    expect(salesVisible).not.toContain("pricing_tier_prices");
    // viewer holds purchasing:read (00266) so purchase-order revisions are
    // legitimately visible, but settings:manage is admin-only.
    expect(await visibleFixtureTypes("viewer")).not.toContain(
      "pricing_tier_prices",
    );
    expect(await visibleFixtureTypes("viewer")).not.toContain("enum_values");
  });

  /**
   * Binds the three hand-maintained copies of the entity_type -> permission
   * mapping (the CASE in the migration, the table in
   * docs/data-model/system.md, and FIXTURE_ENTITY_TYPES above) to the one
   * source of truth that cannot drift: which tables actually carry the
   * trigger. Without this, a future migration that attaches
   * log_entity_revision() to a new table without adding a CASE branch is
   * silently admin-only — fail-closed, so no leak, but also no signal, and
   * docs/data-model/system.md's "add its CASE branch in the same migration"
   * rule would be enforced only by convention.
   */
  it("every table carrying log_entity_revision() is enumerated by the policy", async () => {
    const { rows: tracked } = await ownerPool.query<{ table_name: string }>(
      `SELECT c.relname AS table_name
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
        WHERE NOT t.tgisinternal
          AND t.tgfoid = 'log_entity_revision'::regproc
        ORDER BY 1`,
    );
    const trackedTables = tracked.map((r) => r.table_name);
    // Guards against the query silently matching nothing and passing vacuously.
    expect(trackedTables).toContain("supplier_catalog");
    expect(trackedTables).toContain("enum_values");

    const { rows: policies } = await ownerPool.query<{ qual: string }>(
      `SELECT qual FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'entity_revisions'
          AND policyname = 'entity_revisions_select'`,
    );
    expect(policies).toHaveLength(1);
    const qual = policies[0].qual;

    for (const table of trackedTables) {
      expect(
        qual,
        `${table} carries log_entity_revision() but entity_revisions_select has no CASE branch for it, so its revisions are silently admin-only`,
      ).toContain(`'${table}'`);
      expect(
        FIXTURE_ENTITY_TYPES as readonly string[],
        `${table} carries log_entity_revision() but this spec never probes its visibility`,
      ).toContain(table);
    }
  });
});

describe("entity_revisions remains append-only and enabled-account gated", () => {
  it("has no UPDATE or DELETE policy", async () => {
    await withRoleClient("admin", async (db) => {
      const { rows } = await db.query<{ cmd: string }>(
        `SELECT cmd FROM pg_policies WHERE tablename = 'entity_revisions'`,
      );
      const cmds = rows.map((r) => r.cmd);
      expect(cmds).not.toContain("UPDATE");
      expect(cmds).not.toContain("DELETE");
    });
  });

  it("keeps the restrictive current_user_enabled policy from 00255", async () => {
    await withRoleClient("admin", async (db) => {
      const { rows } = await db.query<{ permissive: string }>(
        `SELECT permissive FROM pg_policies
          WHERE tablename = 'entity_revisions'
            AND policyname = 'current_user_enabled'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].permissive).toBe("RESTRICTIVE");
    });
  });

  it("no longer carries the false RLS-EXCEPTION justification comment", async () => {
    await withRoleClient("admin", async (db) => {
      const { rows } = await db.query<{ description: string | null }>(
        `SELECT d.description
           FROM pg_policy p
           JOIN pg_class c ON c.oid = p.polrelid
           LEFT JOIN pg_description d
             ON d.objoid = p.oid AND d.classoid = 'pg_policy'::regclass
          WHERE c.relname = 'entity_revisions'
            AND p.polname = 'entity_revisions_select'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].description ?? "").not.toContain("RLS-EXCEPTION");
      expect(rows[0].description ?? "").not.toContain(
        "does not leak business data",
      );
    });
  });
});
