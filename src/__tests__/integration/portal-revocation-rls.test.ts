/**
 * Portal-access revocation RLS regressions (issue #605, migration 00276).
 *
 * Revocation stamps `customer_portal_users.revoked_at` instead of deleting the
 * row, so the database — not just the application — must stop honoring the
 * link. These tests exercise the real policies as an authenticated portal user
 * (see `_helpers/role-client.ts` for how the JWT claims are simulated).
 *
 * Fixtures are created here rather than in `_fixtures/seed-roles.sql` and are
 * removed in `afterAll`: they are COMMITTED rows (the role client rolls back
 * its own transaction, so it cannot see uncommitted setup), and dedicated ids
 * keep this file from disturbing the shared seed rows other suites assert on.
 *
 * Run locally:   DATABASE_URL=... bun run test:integration
 * Run in CI:     see .github/workflows/db-lint.yml — integration job.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { SEEDED_UUIDS, teardownPool, withRoleClient } from "./_helpers/role-client";

const REVOKED_CUSTOMER_ID = "00000000-0000-0000-0005-000000000605";
const ACTIVE_CUSTOMER_ID = "00000000-0000-0000-0005-000000000606";
const REVOKED_ORDER_ID = "00000000-0000-0000-0006-000000000605";
const ACTIVE_ORDER_ID = "00000000-0000-0000-0006-000000000606";
const PORTAL_USER_ID = SEEDED_UUIDS.active_customer;

const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });

beforeAll(async () => {
  await adminPool.query(
    `INSERT INTO customers (id, name, customer_type, email, is_active)
     VALUES ($1, 'Revoked Portal Customer', 'wholesale', 'revoked-605@test.local', true),
            ($2, 'Active Portal Customer', 'wholesale', 'active-605@test.local', true)
     ON CONFLICT (id) DO NOTHING`,
    [REVOKED_CUSTOMER_ID, ACTIVE_CUSTOMER_ID],
  );
  await adminPool.query(
    `INSERT INTO orders (id, customer_id, order_number, status, order_date)
     VALUES ($1, $3, 'RLS-REVOKE-605', 'draft', CURRENT_DATE),
            ($2, $4, 'RLS-REVOKE-606', 'draft', CURRENT_DATE)
     ON CONFLICT (id) DO NOTHING`,
    [REVOKED_ORDER_ID, ACTIVE_ORDER_ID, REVOKED_CUSTOMER_ID, ACTIVE_CUSTOMER_ID],
  );
  await adminPool.query(
    `INSERT INTO customer_portal_users (customer_id, user_id, revoked_at)
     VALUES ($1, $3, now()), ($2, $3, NULL)
     ON CONFLICT (customer_id, user_id) DO UPDATE
       SET revoked_at = EXCLUDED.revoked_at`,
    [REVOKED_CUSTOMER_ID, ACTIVE_CUSTOMER_ID, PORTAL_USER_ID],
  );
});

afterAll(async () => {
  const customerIds = [[REVOKED_CUSTOMER_ID, ACTIVE_CUSTOMER_ID]];
  // Explicit child-first order: orders.customer_id has no ON DELETE CASCADE.
  await adminPool.query(
    "DELETE FROM order_change_requests WHERE order_id = ANY($1::uuid[])",
    [[REVOKED_ORDER_ID, ACTIVE_ORDER_ID]],
  );
  await adminPool.query("DELETE FROM orders WHERE customer_id = ANY($1::uuid[])", customerIds);
  await adminPool.query(
    "DELETE FROM customer_portal_users WHERE customer_id = ANY($1::uuid[])",
    customerIds,
  );
  await adminPool.query("DELETE FROM customers WHERE id = ANY($1::uuid[])", customerIds);
  await adminPool.end();
  await teardownPool();
});

describe("revoked portal links (00276)", () => {
  it("hides the tombstoned junction row from the revoked user", async () => {
    await withRoleClient("active_customer", async (db) => {
      const { rows } = await db.query(
        "SELECT customer_id FROM customer_portal_users WHERE user_id = $1",
        [PORTAL_USER_ID],
      );
      expect(rows.map((row) => row.customer_id)).not.toContain(REVOKED_CUSTOMER_ID);
      expect(rows.map((row) => row.customer_id)).toContain(ACTIVE_CUSTOMER_ID);
    });
  });

  it("denies the revoked customer's record and orders while keeping the active link usable", async () => {
    await withRoleClient("active_customer", async (db) => {
      const customers = await db.query(
        "SELECT id FROM customers WHERE id = ANY($1::uuid[])",
        [[REVOKED_CUSTOMER_ID, ACTIVE_CUSTOMER_ID]],
      );
      const orders = await db.query(
        "SELECT id FROM orders WHERE id = ANY($1::uuid[])",
        [[REVOKED_ORDER_ID, ACTIVE_ORDER_ID]],
      );

      expect(customers.rows).toEqual([{ id: ACTIVE_CUSTOMER_ID }]);
      expect(orders.rows).toEqual([{ id: ACTIVE_ORDER_ID }]);
    });
  });

  it("blocks a change request against the revoked customer's order", async () => {
    await withRoleClient("active_customer", async (db) => {
      await expect(
        db.query(
          "INSERT INTO order_change_requests (order_id, requested_by, notes) VALUES ($1, $2, 'revoked')",
          [REVOKED_ORDER_ID, PORTAL_USER_ID],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });
});
