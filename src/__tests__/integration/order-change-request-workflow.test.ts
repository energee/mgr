/** Real-Postgres regressions for the order change-request transaction. */

import type { PoolClient } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  SEEDED_UUIDS,
  teardownPool,
  withRoleClient,
} from "./_helpers/role-client";

const ORDER_ID = "00000000-0000-0000-0006-000000000099";
const OTHER_ORDER_ID = "00000000-0000-0000-0006-000000000098";
const BRAND_ID = "00000000-0000-0000-0488-000000000001";
const ORDER_ITEM_ID = "00000000-0000-0000-0488-000000000002";
const MISSING_BRAND_ID = "00000000-0000-0000-0488-000000000099";

type PgError = Error & { code?: string };

async function seedOrderItem(db: PoolClient): Promise<void> {
  await db.query(
    "INSERT INTO brands (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
    [BRAND_ID, "Issue 488 Atomic Ale"],
  );
  await db.query(
    `INSERT INTO order_items (id, order_id, brand_id, quantity, unit_price)
     VALUES ($1, $2, $3, 5, 12)
     ON CONFLICT (id) DO NOTHING`,
    [ORDER_ITEM_ID, ORDER_ID, BRAND_ID],
  );
}

async function impersonate(
  db: PoolClient,
  userId: string,
): Promise<void> {
  await db.query("SELECT set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
}

async function expectPgCode(
  operation: Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  try {
    await operation;
    throw new Error(`Expected PostgreSQL error ${expectedCode}`);
  } catch (error) {
    expect((error as PgError).code).toBe(expectedCode);
  }
}

function modifyItem(quantity = 4) {
  return {
    change_type: "modify",
    order_item_id: ORDER_ITEM_ID,
    brand_id: BRAND_ID,
    selling_format_id: null,
    quantity,
    original_quantity: 5,
  };
}

async function submit(
  db: PoolClient,
  items: unknown[],
  notes: string,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "SELECT submit_order_change_request($1, $2, $3::jsonb) AS id",
    [ORDER_ID, notes, JSON.stringify(items)],
  );
  return rows[0].id;
}

afterAll(async () => {
  await teardownPool();
});

describe("submit_order_change_request", () => {
  it("commits one parent with all validated items", async () => {
    await withRoleClient("admin", async (db) => {
      await seedOrderItem(db);
      await impersonate(db, SEEDED_UUIDS.active_customer);

      const requestId = await submit(db, [modifyItem()], "Reduce quantity");
      const { rows } = await db.query(
        `SELECT cr.order_id, cr.requested_by, cr.status, count(cri.id)::int AS item_count
         FROM order_change_requests cr
         LEFT JOIN order_change_request_items cri ON cri.change_request_id = cr.id
         WHERE cr.id = $1
         GROUP BY cr.id`,
        [requestId],
      );

      expect(rows).toEqual([{
        order_id: ORDER_ID,
        requested_by: SEEDED_UUIDS.active_customer,
        status: "pending",
        item_count: 1,
      }]);

      await db.query("SAVEPOINT before_customer_parent_update");
      await expectPgCode(
        db.query(
          "UPDATE order_change_requests SET notes = 'forbidden' WHERE id = $1",
          [requestId],
        ),
        "42501",
      );
      await db.query("ROLLBACK TO SAVEPOINT before_customer_parent_update");
    });
  });

  it("rolls back the parent and earlier children when a later child fails", async () => {
    await withRoleClient("admin", async (db) => {
      await seedOrderItem(db);
      await impersonate(db, SEEDED_UUIDS.active_customer);
      await db.query("SAVEPOINT before_invalid_submit");

      await expectPgCode(
        submit(db, [
          modifyItem(),
          {
            change_type: "add",
            order_item_id: null,
            brand_id: MISSING_BRAND_ID,
            selling_format_id: null,
            quantity: 1,
            original_quantity: null,
          },
        ], "rollback-marker"),
        "23503",
      );
      await db.query("ROLLBACK TO SAVEPOINT before_invalid_submit");

      const { rows } = await db.query(
        "SELECT count(*)::int AS count FROM order_change_requests WHERE notes = 'rollback-marker'",
      );
      expect(rows[0].count).toBe(0);
    });
  });

  it("rejects empty submissions without creating an empty pending request", async () => {
    await withRoleClient("admin", async (db) => {
      await impersonate(db, SEEDED_UUIDS.active_customer);
      await db.query("SAVEPOINT before_empty_submit");
      await expectPgCode(submit(db, [], "empty-marker"), "22023");
      await db.query("ROLLBACK TO SAVEPOINT before_empty_submit");

      const { rows } = await db.query(
        "SELECT count(*)::int AS count FROM order_change_requests WHERE notes = 'empty-marker'",
      );
      expect(rows[0].count).toBe(0);
    });
  });

  it("enforces the customer's configured cutoff state", async () => {
    await withRoleClient("admin", async (db) => {
      await seedOrderItem(db);
      const { rows: channels } = await db.query<{ id: string }>(
        "SELECT id FROM sales_channels ORDER BY position LIMIT 1",
      );
      await db.query(
        "UPDATE sales_channels SET change_request_cutoff_state = 'scheduled' WHERE id = $1",
        [channels[0].id],
      );
      await db.query(
        `UPDATE customers SET sales_channel_id = $1
         WHERE id = '00000000-0000-0000-0005-000000000099'`,
        [channels[0].id],
      );
      await db.query("UPDATE orders SET status = 'confirmed' WHERE id = $1", [
        ORDER_ID,
      ]);

      await impersonate(db, SEEDED_UUIDS.active_customer);
      await submit(db, [modifyItem()], "below-custom-cutoff");

      await impersonate(db, SEEDED_UUIDS.admin);
      await db.query("UPDATE orders SET status = 'scheduled' WHERE id = $1", [
        ORDER_ID,
      ]);
      await impersonate(db, SEEDED_UUIDS.active_customer);
      await db.query("SAVEPOINT at_cutoff");
      await expectPgCode(
        submit(db, [modifyItem(3)], "at-custom-cutoff"),
        "PT409",
      );
      await db.query("ROLLBACK TO SAVEPOINT at_cutoff");

      const { rows } = await db.query(
        `SELECT count(*)::int AS count
         FROM order_change_requests
         WHERE notes IN ('below-custom-cutoff', 'at-custom-cutoff')`,
      );
      expect(rows[0].count).toBe(1);
    });
  });
});

describe("reject_order_change_request", () => {
  it("requires both identifiers and reports stale state as a conflict", async () => {
    await withRoleClient("admin", async (db) => {
      await seedOrderItem(db);
      await impersonate(db, SEEDED_UUIDS.active_customer);
      const requestId = await submit(db, [modifyItem()], "Reject me");
      await impersonate(db, SEEDED_UUIDS.admin);

      await db.query("SAVEPOINT before_wrong_order");
      await expectPgCode(
        db.query("SELECT reject_order_change_request($1, $2, $3)", [
          OTHER_ORDER_ID,
          requestId,
          "Wrong order",
        ]),
        "P0002",
      );
      await db.query("ROLLBACK TO SAVEPOINT before_wrong_order");

      await db.query("SELECT reject_order_change_request($1, $2, $3)", [
        ORDER_ID,
        requestId,
        "  Inventory unavailable  ",
      ]);

      await db.query("SAVEPOINT before_stale_reject");
      await expectPgCode(
        db.query("SELECT reject_order_change_request($1, $2, $3)", [
          ORDER_ID,
          requestId,
          "Try again",
        ]),
        "PT409",
      );
      await db.query("ROLLBACK TO SAVEPOINT before_stale_reject");

      const { rows } = await db.query(
        `SELECT status, reviewed_by, rejection_reason
         FROM order_change_requests WHERE id = $1`,
        [requestId],
      );
      expect(rows[0]).toEqual({
        status: "rejected",
        reviewed_by: SEEDED_UUIDS.admin,
        rejection_reason: "Inventory unavailable",
      });
    });
  });

  it("prevents a reviewed request from gaining late items", async () => {
    await withRoleClient("admin", async (db) => {
      await seedOrderItem(db);
      await impersonate(db, SEEDED_UUIDS.active_customer);
      const requestId = await submit(db, [modifyItem()], "Lock children");
      await impersonate(db, SEEDED_UUIDS.admin);
      await db.query("SELECT reject_order_change_request($1, $2, $3)", [
        ORDER_ID,
        requestId,
        "No longer available",
      ]);

      await db.query("SAVEPOINT before_late_item");
      await expectPgCode(
        db.query(
          `INSERT INTO order_change_request_items
             (change_request_id, change_type, order_item_id, brand_id, quantity, original_quantity)
           VALUES ($1, 'modify', $2, $3, 3, 5)`,
          [requestId, ORDER_ITEM_ID, BRAND_ID],
        ),
        "PT409",
      );
      await db.query("ROLLBACK TO SAVEPOINT before_late_item");

      const { rows } = await db.query(
        "SELECT count(*)::int AS count FROM order_change_request_items WHERE change_request_id = $1",
        [requestId],
      );
      expect(rows[0].count).toBe(1);
    });
  });
});
