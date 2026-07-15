/**
 * Real-Postgres regressions for order change-request approval (#476).
 *
 * The approval route is only a thin RPC adapter. These tests exercise the
 * current selling-format schema and prove the order/request transaction plus
 * fulfillment-history guards against a real database.
 */

import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import {
  SEEDED_UUIDS,
  teardownPool,
  withRoleClient,
} from "./_helpers/role-client";

type Fixture = {
  brandId: string;
  orderId: string;
  requestId: string;
  sellingFormatId: string;
};

afterAll(async () => {
  await teardownPool();
});

async function createFixture(db: PoolClient, label: string): Promise<Fixture> {
  const suffix = `${label}-${randomUUID()}`;
  const salesChannelId = randomUUID();
  const customerId = randomUUID();
  const orderId = randomUUID();
  const containerId = randomUUID();
  const sellingFormatId = randomUUID();
  const brandId = randomUUID();
  const requestId = randomUUID();

  await db.query(
    `INSERT INTO sales_channels (
       id, name, code, change_request_cutoff_state
     ) VALUES ($1, $2, $3, 'confirmed')`,
    [salesChannelId, `Change request channel ${suffix}`, `cr-${randomUUID()}`],
  );
  await db.query(
    `INSERT INTO customers (id, name, customer_type, sales_channel_id)
     VALUES ($1, $2, 'wholesale', $3)`,
    [customerId, `Change request customer ${suffix}`, salesChannelId],
  );
  await db.query(
    `INSERT INTO orders (id, customer_id, order_number, status)
     VALUES ($1, $2, $3, 'draft')`,
    [orderId, customerId, `CR-${randomUUID()}`],
  );
  await db.query(
    `INSERT INTO containers (id, name, type, volume_oz)
     VALUES ($1, $2, 'package', 16)`,
    [containerId, `Change request container ${suffix}`],
  );
  await db.query(
    `INSERT INTO selling_formats (id, name, container_id, unit_count)
     VALUES ($1, $2, $3, 24)`,
    [sellingFormatId, `Change request format ${suffix}`, containerId],
  );
  await db.query(
    "INSERT INTO brands (id, name) VALUES ($1, $2)",
    [brandId, `Change request brand ${suffix}`],
  );
  await db.query(
    `INSERT INTO order_change_requests (
       id, order_id, requested_by, status
     ) VALUES ($1, $2, $3, 'pending')`,
    [requestId, orderId, SEEDED_UUIDS.active_customer],
  );

  return { brandId, orderId, requestId, sellingFormatId };
}

async function approve(
  db: PoolClient,
  orderId: string,
  requestId: string,
  approvedBy = SEEDED_UUIDS.admin,
): Promise<void> {
  await db.query("SELECT apply_change_request($1, $2, $3)", [
    orderId,
    requestId,
    approvedBy,
  ]);
}

describe("apply_change_request", () => {
  it("is invoker-rights, authenticated-only, and uses a fixed search path", async () => {
    await withRoleClient("admin", async (db) => {
      const { rows } = await db.query<{
        anon_can_execute: boolean;
        authenticated_can_execute: boolean;
        helper_is_security_definer: boolean;
        is_security_definer: boolean;
        settings: string[] | null;
      }>(`
        SELECT
          has_function_privilege(
            'anon',
            'apply_change_request(uuid,uuid,uuid)',
            'EXECUTE'
          ) AS anon_can_execute,
          has_function_privilege(
            'authenticated',
            'apply_change_request(uuid,uuid,uuid)',
            'EXECUTE'
          ) AS authenticated_can_execute,
          p.prosecdef AS is_security_definer,
          p.proconfig AS settings,
          helper.prosecdef AS helper_is_security_definer
        FROM pg_proc p
        CROSS JOIN pg_proc helper
        WHERE p.oid = 'apply_change_request(uuid,uuid,uuid)'::regprocedure
          AND helper.oid =
            'order_change_has_fulfillment_artifacts(uuid)'::regprocedure
      `);

      expect(rows).toEqual([{
        anon_can_execute: false,
        authenticated_can_execute: true,
        helper_is_security_definer: true,
        is_security_definer: false,
        settings: ["search_path=public"],
      }]);
    });
  });

  it("lets a sales user add a modern selling-format line exactly once", async () => {
    await withRoleClient("admin", async (db) => {
      const fixture = await createFixture(db, "add");
      await db.query(
        `INSERT INTO order_change_request_items (
           change_request_id, change_type, brand_id, selling_format_id,
           quantity, original_quantity
         ) VALUES ($1, 'add', $2, $3, 7, NULL)`,
        [fixture.requestId, fixture.brandId, fixture.sellingFormatId],
      );

      await db.query("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({
          sub: SEEDED_UUIDS.sales,
          role: "authenticated",
        }),
      ]);

      await approve(
        db,
        fixture.orderId,
        fixture.requestId,
        SEEDED_UUIDS.sales,
      );
      await approve(
        db,
        fixture.orderId,
        fixture.requestId,
        SEEDED_UUIDS.sales,
      );

      const item = await db.query<{
        brand_id: string;
        quantity: number;
        selling_format_id: string;
      }>(
        `SELECT brand_id, selling_format_id, quantity
         FROM order_items
         WHERE order_id = $1`,
        [fixture.orderId],
      );
      expect(item.rows).toEqual([{
        brand_id: fixture.brandId,
        selling_format_id: fixture.sellingFormatId,
        quantity: 7,
      }]);

      const request = await db.query<{
        reviewed_by: string;
        status: string;
      }>(
        "SELECT status, reviewed_by FROM order_change_requests WHERE id = $1",
        [fixture.requestId],
      );
      expect(request.rows).toEqual([{
        status: "approved",
        reviewed_by: SEEDED_UUIDS.sales,
      }]);

      const order = await db.query<{ version: number }>(
        "SELECT version FROM orders WHERE id = $1",
        [fixture.orderId],
      );
      expect(order.rows).toEqual([{ version: 2 }]);
    });
  });

  it("modifies and removes current selling-format lines in one approval", async () => {
    await withRoleClient("admin", async (db) => {
      const fixture = await createFixture(db, "modify-remove");
      const modifyItemId = randomUUID();
      const removeItemId = randomUUID();
      await db.query(
        `INSERT INTO order_items (
           id, order_id, brand_id, selling_format_id, quantity
         ) VALUES
           ($1, $3, $4, $5, 5),
           ($2, $3, $4, $5, 3)`,
        [
          modifyItemId,
          removeItemId,
          fixture.orderId,
          fixture.brandId,
          fixture.sellingFormatId,
        ],
      );
      await db.query(
        `INSERT INTO order_change_request_items (
           change_request_id, change_type, order_item_id, brand_id,
           selling_format_id, quantity, original_quantity
         ) VALUES
           ($1, 'modify', $2, $4, $5, 8, 5),
           ($1, 'remove', $3, $4, $5, 0, 3)`,
        [
          fixture.requestId,
          modifyItemId,
          removeItemId,
          fixture.brandId,
          fixture.sellingFormatId,
        ],
      );

      await approve(db, fixture.orderId, fixture.requestId);

      const items = await db.query<{ id: string; quantity: number }>(
        `SELECT id, quantity
         FROM order_items
         WHERE order_id = $1
         ORDER BY id`,
        [fixture.orderId],
      );
      expect(items.rows).toEqual([{ id: modifyItemId, quantity: 8 }]);
    });
  });

  it("rejects approval while a pick list can still reference the old lines", async () => {
    await withRoleClient("admin", async (db) => {
      const fixture = await createFixture(db, "pick-list-conflict");
      const orderItemId = randomUUID();
      await db.query(
        `INSERT INTO order_items (
           id, order_id, brand_id, selling_format_id, quantity
         ) VALUES ($1, $2, $3, $4, 5)`,
        [
          orderItemId,
          fixture.orderId,
          fixture.brandId,
          fixture.sellingFormatId,
        ],
      );
      await db.query(
        `INSERT INTO order_change_request_items (
           change_request_id, change_type, order_item_id, brand_id,
           selling_format_id, quantity, original_quantity
         ) VALUES ($1, 'modify', $2, $3, $4, 6, 5)`,
        [
          fixture.requestId,
          orderItemId,
          fixture.brandId,
          fixture.sellingFormatId,
        ],
      );
      await db.query(
        "INSERT INTO pick_lists (order_id, status) VALUES ($1, 'draft')",
        [fixture.orderId],
      );
      await db.query("SAVEPOINT before_approval");

      await expect(
        approve(db, fixture.orderId, fixture.requestId),
      ).rejects.toMatchObject({ code: "40001" });
      await db.query("ROLLBACK TO SAVEPOINT before_approval");

      const item = await db.query<{ quantity: number }>(
        "SELECT quantity FROM order_items WHERE id = $1",
        [orderItemId],
      );
      expect(item.rows).toEqual([{ quantity: 5 }]);
    });
  });

  it("denies a caller without orders:write before changing the request", async () => {
    await withRoleClient("admin", async (db) => {
      const fixture = await createFixture(db, "viewer-denied");
      await db.query(
        `INSERT INTO order_change_request_items (
           change_request_id, change_type, brand_id, selling_format_id,
           quantity, original_quantity
         ) VALUES ($1, 'add', $2, $3, 2, NULL)`,
        [fixture.requestId, fixture.brandId, fixture.sellingFormatId],
      );
      await db.query("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({
          sub: SEEDED_UUIDS.viewer,
          role: "authenticated",
        }),
      ]);
      await db.query("SAVEPOINT before_approval");

      await expect(
        approve(
          db,
          fixture.orderId,
          fixture.requestId,
          SEEDED_UUIDS.viewer,
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await db.query("ROLLBACK TO SAVEPOINT before_approval");
      await db.query("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({
          sub: SEEDED_UUIDS.admin,
          role: "authenticated",
        }),
      ]);

      const request = await db.query<{ status: string }>(
        "SELECT status FROM order_change_requests WHERE id = $1",
        [fixture.requestId],
      );
      expect(request.rows).toEqual([{ status: "pending" }]);
    });
  });

  it("rolls back earlier line changes when a later line is stale", async () => {
    await withRoleClient("admin", async (db) => {
      const fixture = await createFixture(db, "rollback");
      const otherOrderId = randomUUID();
      const otherItemId = randomUUID();
      await db.query(
        `INSERT INTO orders (id, customer_id, order_number, status)
         SELECT $1, customer_id, $2, 'draft' FROM orders WHERE id = $3`,
        [otherOrderId, `CR-${randomUUID()}`, fixture.orderId],
      );
      await db.query(
        `INSERT INTO order_items (
           id, order_id, brand_id, selling_format_id, quantity
         ) VALUES ($1, $2, $3, $4, 3)`,
        [
          otherItemId,
          otherOrderId,
          fixture.brandId,
          fixture.sellingFormatId,
        ],
      );
      await db.query(
        `INSERT INTO order_change_request_items (
           change_request_id, change_type, brand_id, selling_format_id,
           quantity, original_quantity
         ) VALUES ($1, 'add', $2, $3, 2, NULL)`,
        [fixture.requestId, fixture.brandId, fixture.sellingFormatId],
      );
      await db.query(
        `INSERT INTO order_change_request_items (
           change_request_id, change_type, order_item_id, brand_id,
           selling_format_id, quantity, original_quantity
         ) VALUES ($1, 'modify', $2, $3, $4, 9, 3)`,
        [
          fixture.requestId,
          otherItemId,
          fixture.brandId,
          fixture.sellingFormatId,
        ],
      );
      await db.query("SAVEPOINT before_approval");

      await expect(
        approve(db, fixture.orderId, fixture.requestId),
      ).rejects.toMatchObject({
        code: "40001",
      });
      await db.query("ROLLBACK TO SAVEPOINT before_approval");

      const added = await db.query(
        "SELECT id FROM order_items WHERE order_id = $1",
        [fixture.orderId],
      );
      expect(added.rows).toHaveLength(0);
      const request = await db.query<{ status: string }>(
        "SELECT status FROM order_change_requests WHERE id = $1",
        [fixture.requestId],
      );
      expect(request.rows).toEqual([{ status: "pending" }]);
    });
  });
});
