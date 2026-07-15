/**
 * Regression coverage for the canonical Square draft-sale schema.
 *
 * The webhook writes `selling_format_id` and never writes the retired
 * `keg_type_id`. These tests run against a database built from every migration
 * so historical replay cannot silently restore the legacy required column.
 */

import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildSquareDraftSaleInsert } from "@/integrations/square/utils";
import { teardownPool, withRoleClient } from "./_helpers/role-client";

afterAll(async () => {
  await teardownPool();
});

describe("square_draft_sales canonical schema", () => {
  it("accepts a draft sale identified only by selling_format_id", async () => {
    await withRoleClient("admin", async (db) => {
      const suffix = randomUUID();
      const { rows: containers } = await db.query<{ id: string }>(
        `INSERT INTO containers (name, type, volume_bbl)
         VALUES ($1, 'keg', 0.5)
         RETURNING id`,
        [`Draft schema keg ${suffix}`],
      );
      const { rows: formats } = await db.query<{ id: string }>(
        `INSERT INTO selling_formats (container_id, name, unit_count)
         VALUES ($1, 'Per Keg', 1)
         RETURNING id`,
        [containers[0]!.id],
      );
      const { rows: brands } = await db.query<{ id: string }>(
        `INSERT INTO brands (name) VALUES ($1) RETURNING id`,
        [`Draft schema brand ${suffix}`],
      );
      const { rows: locations } = await db.query<{ id: string }>(
        `INSERT INTO locations (name) VALUES ($1) RETURNING id`,
        [`Draft schema location ${suffix}`],
      );

      const draft = buildSquareDraftSaleInsert({
        orderId: `square-order-${suffix}`,
        paymentId: `square-payment-${suffix}`,
        brandId: brands[0]!.id,
        sellingFormatId: formats[0]!.id,
        quantity: 2,
        volumeOz: 24,
        unitPriceCents: 700,
        locationId: locations[0]!.id,
        soldAt: new Date().toISOString(),
      });

      const { rows } = await db.query<{
        id: string;
        brand_id: string;
        location_id: string;
        quantity: number;
        reconciled_at: Date | null;
        selling_format_id: string;
        sold_at: Date;
        square_order_id: string;
        square_payment_id: string;
        unit_price_cents: number;
        volume_oz: string;
      }>(
        `INSERT INTO square_draft_sales (
           square_order_id,
           square_payment_id,
           brand_id,
           selling_format_id,
           quantity,
           volume_oz,
           unit_price_cents,
           location_id,
           sold_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING
           id,
           square_order_id,
           square_payment_id,
           brand_id,
           selling_format_id,
           quantity,
           volume_oz,
           unit_price_cents,
           location_id,
           sold_at,
           reconciled_at`,
        [
          draft.square_order_id,
          draft.square_payment_id,
          draft.brand_id,
          draft.selling_format_id,
          draft.quantity,
          draft.volume_oz,
          draft.unit_price_cents,
          draft.location_id,
          draft.sold_at,
        ],
      );

      expect(rows[0]).toMatchObject({
        square_order_id: draft.square_order_id,
        square_payment_id: draft.square_payment_id,
        brand_id: draft.brand_id,
        selling_format_id: draft.selling_format_id,
        quantity: draft.quantity,
        volume_oz: "24.00",
        unit_price_cents: draft.unit_price_cents,
        location_id: draft.location_id,
        reconciled_at: null,
      });
      expect(rows[0]!.sold_at).toBeInstanceOf(Date);

      // This is the exact projection consumed by reconcile-draft-sales. Prove
      // the webhook-shaped row is discoverable and its queue marker can stamp.
      const { rows: pending } = await db.query<{
        id: string;
        brand_id: string;
        selling_format_id: string;
        quantity: number;
        volume_oz: string;
        square_order_id: string;
      }>(
        `SELECT id, brand_id, selling_format_id, quantity, volume_oz, square_order_id
           FROM square_draft_sales
          WHERE id = $1
            AND reconciled_at IS NULL
            AND voided_at IS NULL`,
        [rows[0]!.id],
      );
      expect(pending).toEqual([
        {
          id: rows[0]!.id,
          brand_id: draft.brand_id,
          selling_format_id: draft.selling_format_id,
          quantity: draft.quantity,
          volume_oz: "24.00",
          square_order_id: draft.square_order_id,
        },
      ]);

      const { rows: stamped } = await db.query<{ reconciled_at: Date }>(
        `UPDATE square_draft_sales
            SET reconciled_at = now()
          WHERE id = $1
          RETURNING reconciled_at`,
        [rows[0]!.id],
      );
      expect(stamped[0]!.reconciled_at).toBeInstanceOf(Date);
    });
  });

  it("has no legacy keg_type_id contract and deduplicates by selling format", async () => {
    await withRoleClient("admin", async (db) => {
      const { rows: columns } = await db.query<{
        column_name: string;
        is_nullable: "YES" | "NO";
      }>(
        `SELECT column_name, is_nullable
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'square_draft_sales'
            AND column_name IN ('keg_type_id', 'selling_format_id')
          ORDER BY column_name`,
      );

      expect(columns).toEqual([
        { column_name: "selling_format_id", is_nullable: "YES" },
      ]);

      const { rows: indexes } = await db.query<{ indexdef: string }>(
        `SELECT indexdef
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = 'square_draft_sales'
            AND indexname = 'uq_square_draft_sales_dedup'`,
      );

      expect(indexes).toHaveLength(1);
      expect(indexes[0]!.indexdef).toContain(
        "(square_order_id, brand_id, selling_format_id)",
      );
      expect(indexes[0]!.indexdef).not.toContain("keg_type_id");
    });
  });
});
