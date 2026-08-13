/**
 * Portal customer order-placement RLS (Phase 4 node C1, migration 00290).
 *
 * 00290 opens the portal's first INSERT path against a core sales table, so
 * every constraint that keeps it narrow is asserted behaviorally here — as an
 * authenticated portal user, against the real policies — rather than by
 * reading the policy text. A WITH CHECK that looks right and denies nothing is
 * exactly the failure this suite exists to catch.
 *
 * One test per constraint from the plan:
 *   1. a customer cannot insert an order for a different customer
 *   2. status is pinned to the staff-confirm state ('draft')
 *   3. fulfillment-side columns stay staff-owned, and unit_price is never
 *      customer-supplied — pricing is resolved server-side via
 *      get_price_for_customer (src/services/pricing-service.ts) at confirm
 *   4. orders_customer_lock (00276) cannot be composed with the new INSERT
 *      policy to modify a row after creation
 * plus a positive control — the intended flow must actually work, or the
 * denials above prove nothing.
 *
 * Fixtures are COMMITTED rows created here and removed in afterAll, following
 * portal-revocation-rls.test.ts: the role client rolls back its own
 * transaction and so cannot see uncommitted setup. Dedicated ids keep this
 * file from disturbing the shared seed rows other suites assert on.
 *
 * Run locally:   DATABASE_URL=... bun run test:integration
 * Run in CI:     see .github/workflows/db-lint.yml — integration job.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { SEEDED_UUIDS, teardownPool, withRoleClient } from "./_helpers/role-client";

/** The caller's own customer — linked to the seeded active_customer user. */
const OWN_CUSTOMER_ID = "00000000-0000-0000-0005-000000000290";
/** A real customer the caller has no portal link to. */
const OTHER_CUSTOMER_ID = "00000000-0000-0000-0005-000000000291";
/** A pre-existing draft order belonging to the caller, for item-level tests. */
const OWN_DRAFT_ORDER_ID = "00000000-0000-0000-0006-000000000290";
/** A confirmed order belonging to the caller — items must not be appendable. */
const OWN_CONFIRMED_ORDER_ID = "00000000-0000-0000-0006-000000000291";

const PORTAL_USER_ID = SEEDED_UUIDS.active_customer;

/** Postgres raises 42501 when a row fails a WITH CHECK / RLS policy. */
const RLS_VIOLATION = "42501";

const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });

beforeAll(async () => {
  await adminPool.query(
    `INSERT INTO customers (id, name, customer_type, email, is_active)
     VALUES ($1, 'Portal Order Own Customer', 'wholesale', 'own-290@test.local', true),
            ($2, 'Portal Order Other Customer', 'wholesale', 'other-290@test.local', true)
     ON CONFLICT (id) DO NOTHING`,
    [OWN_CUSTOMER_ID, OTHER_CUSTOMER_ID],
  );
  await adminPool.query(
    `INSERT INTO orders (id, customer_id, order_number, status, order_date)
     VALUES ($1, $3, 'RLS-C1-DRAFT-290', 'draft', CURRENT_DATE),
            ($2, $3, 'RLS-C1-CONF-291', 'confirmed', CURRENT_DATE)
     ON CONFLICT (id) DO NOTHING`,
    [OWN_DRAFT_ORDER_ID, OWN_CONFIRMED_ORDER_ID, OWN_CUSTOMER_ID],
  );
  // Only OWN_CUSTOMER_ID is linked. OTHER_CUSTOMER_ID deliberately is not.
  await adminPool.query(
    `INSERT INTO customer_portal_users (customer_id, user_id, revoked_at)
     VALUES ($1, $2, NULL)
     ON CONFLICT (customer_id, user_id) DO UPDATE SET revoked_at = NULL`,
    [OWN_CUSTOMER_ID, PORTAL_USER_ID],
  );
});

afterAll(async () => {
  const customerIds = [[OWN_CUSTOMER_ID, OTHER_CUSTOMER_ID]];
  // Child-first. order_items.order_id cascades, but the positive-control tests
  // commit rows this suite never names, so clear them by join rather than id.
  await adminPool.query(
    `DELETE FROM order_items WHERE order_id IN (
       SELECT id FROM orders WHERE customer_id = ANY($1::uuid[])
     )`,
    customerIds,
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

/**
 * Assert a statement is rejected by RLS *specifically* — not by a foreign key,
 * a CHECK constraint, or a typo in this file's own SQL, each of which would
 * otherwise read as a pass.
 */
async function expectRlsDenied(run: (db: PoolClient) => Promise<unknown>): Promise<void> {
  await withRoleClient("active_customer", async (db) => {
    await expect(run(db)).rejects.toMatchObject({ code: RLS_VIOLATION });
  });
}

describe("orders_customer_insert — customer scoping (00290, constraint 1)", () => {
  it("allows a draft order for the caller's own customer", async () => {
    await withRoleClient("active_customer", async (db) => {
      const { rows } = await db.query<{ id: string; order_number: string; status: string }>(
        `INSERT INTO orders (customer_id, status, order_date)
         VALUES ($1, 'draft', CURRENT_DATE)
         RETURNING id, order_number, status`,
        [OWN_CUSTOMER_ID],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("draft");
      // The DEFAULT must fire under portal RLS: generate_next_order_number()
      // is SECURITY DEFINER precisely so this does not collide (00290).
      expect(rows[0].order_number).toMatch(/^ORD-\d{4}-/);
    });
  });

  it("denies an order naming a customer the caller has no portal link to", async () => {
    await expectRlsDenied((db) =>
      db.query(
        `INSERT INTO orders (customer_id, status, order_date)
         VALUES ($1, 'draft', CURRENT_DATE)`,
        [OTHER_CUSTOMER_ID],
      ),
    );
  });
});

describe("orders_customer_insert — staff-confirm state (00290, constraint 2)", () => {
  it.each(["confirmed", "scheduled", "picking", "packed", "fulfilled"])(
    "denies creating an order already in '%s'",
    async (status) => {
      await expectRlsDenied((db) =>
        db.query(
          `INSERT INTO orders (customer_id, status, order_date)
           VALUES ($1, $2, CURRENT_DATE)`,
          [OWN_CUSTOMER_ID, status],
        ),
      );
    },
  );
});

describe("orders_customer_insert — staff-owned columns (00290, constraint 3)", () => {
  it("denies presetting scheduled_date", async () => {
    await expectRlsDenied((db) =>
      db.query(
        `INSERT INTO orders (customer_id, status, order_date, scheduled_date)
         VALUES ($1, 'draft', CURRENT_DATE, CURRENT_DATE)`,
        [OWN_CUSTOMER_ID],
      ),
    );
  });

  it("denies presetting fulfilled_date", async () => {
    await expectRlsDenied((db) =>
      db.query(
        `INSERT INTO orders (customer_id, status, order_date, fulfilled_date)
         VALUES ($1, 'draft', CURRENT_DATE, CURRENT_DATE)`,
        [OWN_CUSTOMER_ID],
      ),
    );
  });

  it("denies claiming export status", async () => {
    await expectRlsDenied((db) =>
      db.query(
        `INSERT INTO orders (customer_id, status, order_date, is_export)
         VALUES ($1, 'draft', CURRENT_DATE, TRUE)`,
        [OWN_CUSTOMER_ID],
      ),
    );
  });
});

describe("order_items_customer_insert — pricing stays server-side (00290, constraint 3)", () => {
  it("allows an unpriced line on the caller's own draft order", async () => {
    await withRoleClient("active_customer", async (db) => {
      const { rows } = await db.query<{ unit_price: string | null }>(
        `INSERT INTO order_items (order_id, quantity)
         VALUES ($1, 5)
         RETURNING unit_price`,
        [OWN_DRAFT_ORDER_ID],
      );
      expect(rows[0].unit_price).toBeNull();
    });
  });

  it("denies a customer-supplied unit_price", async () => {
    await expectRlsDenied((db) =>
      db.query(
        `INSERT INTO order_items (order_id, quantity, unit_price)
         VALUES ($1, 5, 0.01)`,
        [OWN_DRAFT_ORDER_ID],
      ),
    );
  });

  it("denies appending items to an order staff already confirmed", async () => {
    await expectRlsDenied((db) =>
      db.query(
        `INSERT INTO order_items (order_id, quantity)
         VALUES ($1, 5)`,
        [OWN_CONFIRMED_ORDER_ID],
      ),
    );
  });
});

describe("no composition escape from orders_customer_lock (00290, constraint 4)", () => {
  it("still denies a plain UPDATE of the caller's own order", async () => {
    // orders_customer_lock is WITH CHECK (false); adding an INSERT policy must
    // not change that, since INSERT policies do not apply to UPDATE.
    await expectRlsDenied((db) =>
      db.query("UPDATE orders SET status = 'confirmed' WHERE id = $1", [OWN_DRAFT_ORDER_ID]),
    );
  });

  it("denies escalating an existing order via ON CONFLICT DO UPDATE", async () => {
    // ON CONFLICT DO UPDATE requires the UPDATE policy's WITH CHECK to pass,
    // so the lock holds even where the caller may legitimately INSERT.
    await expectRlsDenied((db) =>
      db.query(
        `INSERT INTO orders (customer_id, order_number, status, order_date)
         VALUES ($1, 'RLS-C1-DRAFT-290', 'draft', CURRENT_DATE)
         ON CONFLICT (order_number) DO UPDATE SET status = 'confirmed'`,
        [OWN_CUSTOMER_ID],
      ),
    );
  });
});
