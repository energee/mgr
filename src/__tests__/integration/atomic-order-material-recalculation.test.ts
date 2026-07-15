/** Real-Postgres regressions for transactional order-material recalculation (#489). */

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  SEEDED_UUIDS,
  teardownPool,
  withRoleClient,
} from "./_helpers/role-client";

type Fixture = {
  brandId: string;
  defaultPalletId: string;
  formatId: string;
  orderId: string;
  overridePalletId: string;
  wrapId: string;
};

type MaterialRow = {
  actual_qty: number | null;
  estimated_qty: number;
  inventory_item_id: string;
};

afterAll(async () => {
  await teardownPool();
});

async function createFixture(db: PoolClient, label: string): Promise<Fixture> {
  const suffix = `${label}-${randomUUID()}`;
  const salesChannelId = randomUUID();
  const pricingTierId = randomUUID();
  const customerId = randomUUID();
  const orderId = randomUUID();
  const containerId = randomUUID();
  const formatId = randomUUID();
  const brandId = randomUUID();
  const defaultPalletId = randomUUID();
  const overridePalletId = randomUUID();
  const wrapId = randomUUID();

  await db.query(
    `INSERT INTO sales_channels (id, name, code)
     VALUES ($1, $2, $3)`,
    [salesChannelId, `Materials channel ${suffix}`, `materials-${randomUUID()}`],
  );
  await db.query(
    "INSERT INTO pricing_tiers (id, name) VALUES ($1, $2)",
    [pricingTierId, `Materials tier ${suffix}`],
  );
  await db.query(
    `INSERT INTO customers (
       id, name, customer_type, sales_channel_id, price_tier_id
     ) VALUES ($1, $2, 'wholesale', $3, $4)`,
    [customerId, `Materials customer ${suffix}`, salesChannelId, pricingTierId],
  );
  await db.query(
    `INSERT INTO orders (id, customer_id, order_number, status)
     VALUES ($1, $2, $3, 'draft')`,
    [orderId, customerId, `MAT-${randomUUID()}`],
  );
  await db.query(
    `INSERT INTO containers (id, name, type, volume_oz)
     VALUES ($1, $2, 'package', 16)`,
    [containerId, `Materials container ${suffix}`],
  );
  await db.query(
    `INSERT INTO selling_formats (
       id, name, container_id, unit_count, units_per_layer, default_layers
     ) VALUES ($1, $2, $3, 24, 10, 2)`,
    [formatId, `Materials format ${suffix}`, containerId],
  );
  await db.query(
    "INSERT INTO brands (id, name) VALUES ($1, $2)",
    [brandId, `Materials brand ${suffix}`],
  );
  await db.query(
    `INSERT INTO pricing_tier_prices (
       pricing_tier_id, format_id, sales_channel_id, price
     ) VALUES ($1, $2, $3, 72.50)`,
    [pricingTierId, formatId, salesChannelId],
  );
  await db.query(
    `INSERT INTO inventory_items (id, category, name, unit)
     VALUES
       ($1, 'packaging', $4, 'each'),
       ($2, 'packaging', $5, 'each'),
       ($3, 'packaging', $6, 'each')`,
    [
      defaultPalletId,
      overridePalletId,
      wrapId,
      `Default pallet ${suffix}`,
      `Override pallet ${suffix}`,
      `Wrap ${suffix}`,
    ],
  );
  await db.query(
    `INSERT INTO brewery_shipping_defaults (inventory_item_id, material_role)
     VALUES ($1, 'pallet'), ($2, 'wrap')`,
    [defaultPalletId, wrapId],
  );
  await db.query(
    `INSERT INTO customer_shipping_materials (
       customer_id, inventory_item_id, material_role
     ) VALUES ($1, $2, 'pallet')`,
    [customerId, overridePalletId],
  );
  await db.query(
    `INSERT INTO customer_pallet_configs (customer_id, selling_format_id, layers)
     VALUES ($1, $2, 3)`,
    [customerId, formatId],
  );

  return {
    brandId,
    defaultPalletId,
    formatId,
    orderId,
    overridePalletId,
    wrapId,
  };
}

async function createRequest(db: PoolClient, orderId: string): Promise<string> {
  const requestId = randomUUID();
  await db.query(
    `INSERT INTO order_change_requests (
       id, order_id, requested_by, status
     ) VALUES ($1, $2, $3, 'pending')`,
    [requestId, orderId, SEEDED_UUIDS.active_customer],
  );
  return requestId;
}

async function approve(
  db: PoolClient,
  orderId: string,
  requestId: string,
): Promise<void> {
  await db.query("SELECT apply_change_request($1, $2, $3)", [
    orderId,
    requestId,
    SEEDED_UUIDS.admin,
  ]);
}

async function readMaterials(
  db: PoolClient,
  orderId: string,
): Promise<MaterialRow[]> {
  const { rows } = await db.query<MaterialRow>(
    `SELECT inventory_item_id,
            estimated_qty::float8 AS estimated_qty,
            actual_qty::float8 AS actual_qty
     FROM order_materials
     WHERE order_id = $1
     ORDER BY inventory_item_id`,
    [orderId],
  );
  return rows;
}

function byInventory(rows: MaterialRow[]): Map<string, MaterialRow> {
  return new Map(rows.map((row) => [row.inventory_item_id, row]));
}

describe("transactional order-material recalculation", () => {
  it("recalculates direct writes with customer overrides and preserves manual actual quantities", async () => {
    await withRoleClient("admin", async (db) => {
      const fixture = await createFixture(db, "direct");
      const orderItemId = randomUUID();

      await db.query(
        `INSERT INTO order_items (
           id, order_id, brand_id, selling_format_id, quantity, unit_price
         ) VALUES ($1, $2, $3, $4, 31, 72.50)`,
        [orderItemId, fixture.orderId, fixture.brandId, fixture.formatId],
      );

      let rows = byInventory(await readMaterials(db, fixture.orderId));
      expect(rows.has(fixture.defaultPalletId)).toBe(false);
      expect(rows.get(fixture.overridePalletId)).toMatchObject({
        actual_qty: null,
        estimated_qty: 2,
      });
      expect(rows.get(fixture.wrapId)).toMatchObject({
        actual_qty: null,
        estimated_qty: 2,
      });

      await db.query(
        `UPDATE order_materials SET actual_qty = 9
         WHERE order_id = $1 AND inventory_item_id = $2`,
        [fixture.orderId, fixture.overridePalletId],
      );
      await db.query("UPDATE order_items SET quantity = 61 WHERE id = $1", [
        orderItemId,
      ]);

      rows = byInventory(await readMaterials(db, fixture.orderId));
      expect(rows.get(fixture.overridePalletId)).toMatchObject({
        actual_qty: 9,
        estimated_qty: 3,
      });
      expect(rows.get(fixture.wrapId)?.estimated_qty).toBe(3);

      await db.query("DELETE FROM order_items WHERE id = $1", [orderItemId]);
      rows = byInventory(await readMaterials(db, fixture.orderId));
      expect(rows.get(fixture.overridePalletId)).toMatchObject({
        actual_qty: 9,
        estimated_qty: 0,
      });
      expect(rows.get(fixture.wrapId)?.estimated_qty).toBe(0);
    });
  });

  it("recalculates an approved add in the approval transaction", async () => {
    await withRoleClient("admin", async (db) => {
      const fixture = await createFixture(db, "approve-add");
      const requestId = await createRequest(db, fixture.orderId);
      await db.query(
        `INSERT INTO order_change_request_items (
           change_request_id, change_type, brand_id, selling_format_id,
           quantity, original_quantity
         ) VALUES ($1, 'add', $2, $3, 31, NULL)`,
        [requestId, fixture.brandId, fixture.formatId],
      );

      await approve(db, fixture.orderId, requestId);

      const rows = byInventory(await readMaterials(db, fixture.orderId));
      expect(rows.get(fixture.overridePalletId)?.estimated_qty).toBe(2);
      expect(rows.get(fixture.wrapId)?.estimated_qty).toBe(2);
    });
  });

  it("recalculates approved modify and remove changes from the final line state", async () => {
    await withRoleClient("admin", async (db) => {
      const fixture = await createFixture(db, "approve-modify-remove");
      const modifyItemId = randomUUID();
      const removeItemId = randomUUID();
      await db.query(
        `INSERT INTO order_items (
           id, order_id, brand_id, selling_format_id, quantity, unit_price
         ) VALUES
           ($1, $3, $4, $5, 31, 72.50),
           ($2, $3, $4, $5, 15, 72.50)`,
        [
          modifyItemId,
          removeItemId,
          fixture.orderId,
          fixture.brandId,
          fixture.formatId,
        ],
      );
      const requestId = await createRequest(db, fixture.orderId);
      await db.query(
        `INSERT INTO order_change_request_items (
           change_request_id, change_type, order_item_id, brand_id,
           selling_format_id, quantity, original_quantity
         ) VALUES
           ($1, 'modify', $2, $4, $5, 1, 31),
           ($1, 'remove', $3, $4, $5, 0, 15)`,
        [
          requestId,
          modifyItemId,
          removeItemId,
          fixture.brandId,
          fixture.formatId,
        ],
      );

      await approve(db, fixture.orderId, requestId);

      const rows = byInventory(await readMaterials(db, fixture.orderId));
      expect(rows.get(fixture.overridePalletId)?.estimated_qty).toBe(1);
      expect(rows.get(fixture.wrapId)?.estimated_qty).toBe(1);
    });
  });

  it("rolls approval line changes back when material recalculation fails", async () => {
    await withRoleClient("admin", async (db) => {
      const fixture = await createFixture(db, "approval-rollback");
      const requestId = await createRequest(db, fixture.orderId);
      await db.query(
        `INSERT INTO order_change_request_items (
           change_request_id, change_type, brand_id, selling_format_id,
           quantity, original_quantity
         ) VALUES ($1, 'add', $2, $3, 31, NULL)`,
        [requestId, fixture.brandId, fixture.formatId],
      );
      await db.query(`
        CREATE FUNCTION pg_temp.fail_order_material_recalculation()
        RETURNS trigger LANGUAGE plpgsql AS $body$
        BEGIN
          IF NEW.order_id = '${fixture.orderId}'::uuid THEN
            RAISE EXCEPTION 'injected order-material failure';
          END IF;
          RETURN NEW;
        END;
        $body$;
        CREATE TRIGGER fail_order_material_recalculation
          BEFORE INSERT OR UPDATE ON order_materials
          FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_order_material_recalculation();
      `);
      await db.query("SAVEPOINT before_approval");

      await expect(
        approve(db, fixture.orderId, requestId),
      ).rejects.toThrow("injected order-material failure");
      await db.query("ROLLBACK TO SAVEPOINT before_approval");

      const items = await db.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM order_items WHERE order_id = $1`,
        [fixture.orderId],
      );
      const request = await db.query<{ status: string }>(
        "SELECT status FROM order_change_requests WHERE id = $1",
        [requestId],
      );
      expect(items.rows[0].count).toBe(0);
      expect(request.rows[0].status).toBe("pending");
    });
  });

  it("exposes the recalculation primitive only as invoker rights", async () => {
    await withRoleClient("admin", async (db) => {
      const { rows } = await db.query<{
        anon_can_execute: boolean;
        authenticated_can_execute: boolean;
        is_security_definer: boolean;
        settings: string[] | null;
      }>(`
        SELECT
          has_function_privilege(
            'anon', 'recalculate_order_materials(uuid)', 'EXECUTE'
          ) AS anon_can_execute,
          has_function_privilege(
            'authenticated', 'recalculate_order_materials(uuid)', 'EXECUTE'
          ) AS authenticated_can_execute,
          p.prosecdef AS is_security_definer,
          p.proconfig AS settings
        FROM pg_proc p
        WHERE p.oid = 'recalculate_order_materials(uuid)'::regprocedure
      `);

      expect(rows).toEqual([{
        anon_can_execute: false,
        authenticated_can_execute: true,
        is_security_definer: false,
        settings: ["search_path=public"],
      }]);
    });
  });
});
