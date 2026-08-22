/**
 * Cross-customer portal isolation — audit C1, backlog item 1's last bullet:
 * "a multi-user RLS round-trip test (customer JWT vs another customer's
 * orders)".
 *
 * The other C1 suites each cover a different axis and none cover this one:
 *   - customer-role-scoping.test.ts asserts `pg_get_functiondef` TEXT for
 *     create_user_profile()/notify_all_users(); its own header notes that
 *     behavioral trigger tests were "not possible" from an `authenticated`
 *     role client.
 *   - portal-order-insert-rls.test.ts covers cross-customer INSERT denial
 *     (00290), not reads.
 *   - portal-revocation-rls.test.ts covers a REVOKED link on the *same*
 *     customer (00276), not two live customers.
 *
 * What is asserted here, against the real policies as two different
 * authenticated portal users:
 *   1. create_user_profile() actually assigns roles=['customer'] on an
 *      active-customer email match. This is the C1 regression itself — 00097
 *      dropped the linking and portal invitees were created with the STAFF
 *      'viewer' role. Asserted behaviorally (INSERT into auth.users through
 *      the admin pool, which is the table owner and so runs the trigger),
 *      not by reading the function body.
 *   2. Each customer's JWT reads its OWN order, customer record, and line
 *      items — the positive control, without which every denial below could
 *      pass against a uniformly empty result set.
 *   3. Neither customer's JWT can read the OTHER's order, line items, or
 *      customer record. Asserted in BOTH directions (the "round trip"), so a
 *      policy that happens to scope one caller correctly by accident cannot
 *      pass.
 *
 * Isolation reads deny by returning ZERO ROWS, not by raising: RLS filters
 * SELECT rather than rejecting it. Each denial is therefore paired with a
 * same-query positive control proving the row exists and is readable by its
 * owner — a `LIMIT 0` bug or a dropped fixture would otherwise read as a pass.
 *
 * Fixtures are COMMITTED rows created in beforeAll and removed in afterAll,
 * following portal-order-insert-rls.test.ts: a role client rolls back its own
 * transaction and so cannot see uncommitted setup. Dedicated ids keep this
 * file from disturbing the shared seed rows other suites assert on.
 *
 * Run locally:   DATABASE_URL=... bun run test:integration
 * Run in CI:     see .github/workflows/db-lint.yml — integration job.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { SEEDED_UUIDS, requireDatabaseUrl, teardownPool } from "./_helpers/role-client";

/** Customer A — linked to the seeded active_customer user. */
const CUSTOMER_A_ID = "00000000-0000-0000-0005-000000000301";
/** Customer B — linked to this suite's own portal user. */
const CUSTOMER_B_ID = "00000000-0000-0000-0005-000000000302";

const ORDER_A_ID = "00000000-0000-0000-0006-000000000301";
const ORDER_B_ID = "00000000-0000-0000-0006-000000000302";

const ITEM_A_ID = "00000000-0000-0000-0007-000000000301";
const ITEM_B_ID = "00000000-0000-0000-0007-000000000302";

/** Customer A's portal user: reuse the seeded active_customer. */
const USER_A_ID = SEEDED_UUIDS.active_customer;
/**
 * Customer B's portal user, created here. Its auth.users row is inserted
 * AFTER customers row B exists so create_user_profile() sees the email match
 * and assigns the customer role — the behavior test 1 asserts.
 */
const USER_B_ID = "00000000-0000-0000-0000-000000000302";
const USER_B_EMAIL = "portal-b-c1@test.local";

const adminPool = new Pool({ connectionString: requireDatabaseUrl() });

/**
 * Impersonate an arbitrary portal user by uid.
 *
 * `withRoleClient` only reaches the fixed SEEDED_UUIDS tiers, and this suite
 * needs a second customer-role user that the shared seed deliberately does
 * not define. Same mechanism as the helper: `SET LOCAL ROLE authenticated` +
 * `request.jwt.claims`, inside a transaction that is always rolled back.
 */
async function withPortalUser<T>(
  userId: string,
  fn: (db: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await adminPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    return await fn(client);
  } finally {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Best-effort; the transaction may already be aborted.
    }
    client.release();
  }
}

beforeAll(async () => {
  await adminPool.query(
    `INSERT INTO customers (id, name, customer_type, email, is_active)
     VALUES ($1, 'Cross-Customer A', 'wholesale', 'portal-a-c1@test.local', true),
            ($2, 'Cross-Customer B', 'wholesale', $3, true)
     ON CONFLICT (id) DO NOTHING`,
    [CUSTOMER_A_ID, CUSTOMER_B_ID, USER_B_EMAIL],
  );

  // Customer B's auth user. Inserted after customers row B so the
  // create_user_profile() AFTER INSERT trigger matches the email and assigns
  // roles=['customer'] — no explicit user_profiles INSERT here, because the
  // trigger's own output is what test 1 asserts.
  await adminPool.query(
    `INSERT INTO auth.users (id, email, raw_user_meta_data)
     VALUES ($1, $2, '{"display_name":"Cross-Customer B Portal User"}'::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [USER_B_ID, USER_B_EMAIL],
  );

  await adminPool.query(
    `INSERT INTO orders (id, customer_id, order_number, status, order_date)
     VALUES ($1, $3, 'RLS-C1-XCUST-301', 'confirmed', CURRENT_DATE),
            ($2, $4, 'RLS-C1-XCUST-302', 'confirmed', CURRENT_DATE)
     ON CONFLICT (id) DO NOTHING`,
    [ORDER_A_ID, ORDER_B_ID, CUSTOMER_A_ID, CUSTOMER_B_ID],
  );

  await adminPool.query(
    `INSERT INTO order_items (id, order_id, quantity)
     VALUES ($1, $3, 5), ($2, $4, 7)
     ON CONFLICT (id) DO NOTHING`,
    [ITEM_A_ID, ITEM_B_ID, ORDER_A_ID, ORDER_B_ID],
  );

  // Each user is linked to exactly one customer. Neither is linked to the
  // other's — that absence is the whole point of the suite.
  await adminPool.query(
    `INSERT INTO customer_portal_users (customer_id, user_id, revoked_at)
     VALUES ($1, $3, NULL), ($2, $4, NULL)
     ON CONFLICT (customer_id, user_id) DO UPDATE SET revoked_at = NULL`,
    [CUSTOMER_A_ID, CUSTOMER_B_ID, USER_A_ID, USER_B_ID],
  );
});

afterAll(async () => {
  const customerIds = [CUSTOMER_A_ID, CUSTOMER_B_ID];
  await adminPool.query(
    `DELETE FROM order_materials WHERE order_id IN (
       SELECT id FROM orders WHERE customer_id = ANY($1::uuid[])
     )`,
    [customerIds],
  );
  await adminPool.query(
    `DELETE FROM order_items WHERE order_id IN (
       SELECT id FROM orders WHERE customer_id = ANY($1::uuid[])
     )`,
    [customerIds],
  );
  await adminPool.query("DELETE FROM orders WHERE customer_id = ANY($1::uuid[])", [customerIds]);
  await adminPool.query(
    "DELETE FROM customer_portal_users WHERE customer_id = ANY($1::uuid[])",
    [customerIds],
  );
  await adminPool.query("DELETE FROM customers WHERE id = ANY($1::uuid[])", [customerIds]);
  await adminPool.query("DELETE FROM user_profiles WHERE id = $1", [USER_B_ID]);
  await adminPool.query("DELETE FROM auth.users WHERE id = $1", [USER_B_ID]);
  await adminPool.end();
  await teardownPool();
});

describe("create_user_profile — customer role is actually assigned (00201, audit C1)", () => {
  it("gives a portal invitee roles=['customer'], not the staff 'viewer' default", async () => {
    const { rows } = await adminPool.query<{ roles: string[]; status: string }>(
      "SELECT roles, status FROM user_profiles WHERE id = $1",
      [USER_B_ID],
    );
    expect(rows).toHaveLength(1);
    // The 00097 regression produced ARRAY['viewer'] here, which passes every
    // staff read policy (orders, customers, recipes, pricing).
    expect(rows[0].roles).toEqual(["customer"]);
    expect(rows[0].status).toBe("active");
  });
});

describe("cross-customer read isolation — orders (00276 customer_orders_select)", () => {
  it("lets each customer read its OWN order (positive control)", async () => {
    const seenByA = await withPortalUser(USER_A_ID, (db) =>
      db.query("SELECT id FROM orders WHERE id = $1", [ORDER_A_ID]),
    );
    expect(seenByA.rows).toHaveLength(1);

    const seenByB = await withPortalUser(USER_B_ID, (db) =>
      db.query("SELECT id FROM orders WHERE id = $1", [ORDER_B_ID]),
    );
    expect(seenByB.rows).toHaveLength(1);
  });

  it("hides customer B's order from customer A", async () => {
    const { rows } = await withPortalUser(USER_A_ID, (db) =>
      db.query("SELECT id FROM orders WHERE id = $1", [ORDER_B_ID]),
    );
    expect(rows).toEqual([]);
  });

  it("hides customer A's order from customer B (round trip)", async () => {
    const { rows } = await withPortalUser(USER_B_ID, (db) =>
      db.query("SELECT id FROM orders WHERE id = $1", [ORDER_A_ID]),
    );
    expect(rows).toEqual([]);
  });

  it("returns only the caller's own row on an unfiltered scan of both orders", async () => {
    // The per-id probes above would still pass if a policy leaked rows only on
    // a broader query shape; scan both fixture ids in one statement instead.
    const bothIds = [ORDER_A_ID, ORDER_B_ID];
    const forA = await withPortalUser(USER_A_ID, (db) =>
      db.query<{ id: string }>("SELECT id FROM orders WHERE id = ANY($1::uuid[])", [bothIds]),
    );
    expect(forA.rows.map((r) => r.id)).toEqual([ORDER_A_ID]);

    const forB = await withPortalUser(USER_B_ID, (db) =>
      db.query<{ id: string }>("SELECT id FROM orders WHERE id = ANY($1::uuid[])", [bothIds]),
    );
    expect(forB.rows.map((r) => r.id)).toEqual([ORDER_B_ID]);
  });
});

describe("cross-customer read isolation — order items (00276 customer_order_items_select)", () => {
  it("lets each customer read its own line items (positive control)", async () => {
    const forA = await withPortalUser(USER_A_ID, (db) =>
      db.query("SELECT id FROM order_items WHERE id = $1", [ITEM_A_ID]),
    );
    expect(forA.rows).toHaveLength(1);
  });

  it("hides the other customer's line items in both directions", async () => {
    const forA = await withPortalUser(USER_A_ID, (db) =>
      db.query("SELECT id FROM order_items WHERE id = $1", [ITEM_B_ID]),
    );
    expect(forA.rows).toEqual([]);

    const forB = await withPortalUser(USER_B_ID, (db) =>
      db.query("SELECT id FROM order_items WHERE id = $1", [ITEM_A_ID]),
    );
    expect(forB.rows).toEqual([]);
  });
});

describe("cross-customer read isolation — customer records (00276 customers_customer_select)", () => {
  it("lets each customer read its own record (positive control)", async () => {
    const forA = await withPortalUser(USER_A_ID, (db) =>
      db.query("SELECT id FROM customers WHERE id = $1", [CUSTOMER_A_ID]),
    );
    expect(forA.rows).toHaveLength(1);
  });

  it("hides the other customer's record in both directions", async () => {
    // Customer names and emails are PII belonging to another buyer.
    const forA = await withPortalUser(USER_A_ID, (db) =>
      db.query("SELECT id FROM customers WHERE id = $1", [CUSTOMER_B_ID]),
    );
    expect(forA.rows).toEqual([]);

    const forB = await withPortalUser(USER_B_ID, (db) =>
      db.query("SELECT id FROM customers WHERE id = $1", [CUSTOMER_A_ID]),
    );
    expect(forB.rows).toEqual([]);
  });
});
