/**
 * Real-Postgres regression for duplicate-supplier catalog collisions (#478).
 *
 * Execute the tracked one-shot migration against temporary fixture tables so
 * this test covers the migration itself without altering the replayed schema.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const migration = readFileSync(
  path.join(
    process.cwd(),
    "supabase/migrations/00252_merge_duplicate_suppliers.sql",
  ),
  "utf8",
);

afterAll(async () => {
  await pool.end();
});

describe("duplicate supplier merge migration", () => {
  it("carries a losing catalog preference onto the surviving collision row", async () => {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query(`
        CREATE TEMP TABLE suppliers (
          id uuid PRIMARY KEY,
          name text NOT NULL,
          contact_name text,
          contact_email text,
          contact_phone text,
          address jsonb,
          default_lead_time_days integer,
          payment_terms text,
          notes text,
          created_at timestamptz NOT NULL
        );

        CREATE TEMP TABLE supplier_catalog (
          supplier_id uuid NOT NULL,
          catalog_type text NOT NULL,
          catalog_id uuid NOT NULL,
          is_preferred boolean DEFAULT false,
          UNIQUE (supplier_id, catalog_type, catalog_id)
        );

        CREATE TEMP TABLE purchase_orders (
          id uuid PRIMARY KEY,
          supplier_id uuid NOT NULL
        );
      `);

      const survivorId = "11111111-1111-4111-8111-111111111111";
      const loserId = "22222222-2222-4222-8222-222222222222";
      const itemId = "33333333-3333-4333-8333-333333333333";
      const purchaseOrderId = "44444444-4444-4444-8444-444444444444";

      await db.query(
        `INSERT INTO suppliers (
           id, name, contact_email, created_at
         ) VALUES
           ($1, '  Acme   Supply ', 'buyer@acme.test', '2026-01-01T00:00:00Z'),
           ($2, 'acme supply', NULL, '2026-02-01T00:00:00Z')`,
        [survivorId, loserId],
      );
      await db.query(
        `INSERT INTO supplier_catalog (
           supplier_id, catalog_type, catalog_id, is_preferred
         ) VALUES
           ($1, 'hop', $3, false),
           ($2, 'hop', $3, true)`,
        [survivorId, loserId, itemId],
      );
      await db.query(
        "INSERT INTO purchase_orders (id, supplier_id) VALUES ($1, $2)",
        [purchaseOrderId, loserId],
      );

      await db.query(migration);

      const { rows: suppliers } = await db.query<{
        id: string;
        name: string;
      }>("SELECT id, name FROM suppliers");
      expect(suppliers).toEqual([
        { id: survivorId, name: "Acme Supply" },
      ]);

      const { rows: catalog } = await db.query<{
        supplier_id: string;
        is_preferred: boolean;
      }>(
        `SELECT supplier_id, is_preferred
           FROM supplier_catalog
          WHERE catalog_type = 'hop' AND catalog_id = $1`,
        [itemId],
      );
      expect(catalog).toEqual([
        { supplier_id: survivorId, is_preferred: true },
      ]);

      const { rows: purchaseOrders } = await db.query<{
        supplier_id: string;
      }>("SELECT supplier_id FROM purchase_orders WHERE id = $1", [
        purchaseOrderId,
      ]);
      expect(purchaseOrders).toEqual([{ supplier_id: survivorId }]);
    } finally {
      await db.query("ROLLBACK");
      db.release();
    }
  });
});
