/**
 * Regression coverage for the per-owner keg deposit override schema (#711).
 *
 * keg_owner_deposits carried the last NOT NULL keg_type_id of the retired
 * keg_types contract, so on a chain-built database every deposit override
 * insert failed with "null value in column keg_type_id ... violates not-null
 * constraint". 00284 retires the column (mirroring 00283 for
 * keg_transactions) and re-keys uniqueness on (keg_owner_id,
 * selling_format_id). These tests run against a database built from every
 * migration so historical replay cannot silently restore the legacy required
 * column.
 */

import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { teardownPool, withRoleClient } from "./_helpers/role-client";

afterAll(async () => {
  await teardownPool();
});

describe("keg_owner_deposits canonical schema", () => {
  it("accepts a deposit override keyed only by selling_format_id", async () => {
    await withRoleClient("admin", async (db) => {
      const suffix = randomUUID();
      const { rows: containers } = await db.query<{ id: string }>(
        `INSERT INTO containers (name, type, volume_bbl)
         VALUES ($1, 'keg', 0.5)
         RETURNING id`,
        [`Deposit schema keg ${suffix}`],
      );
      const { rows: formats } = await db.query<{ id: string }>(
        `INSERT INTO selling_formats (container_id, name, unit_count)
         VALUES ($1, 'Per Keg', 1)
         RETURNING id`,
        [containers[0]!.id],
      );
      const { rows: owners } = await db.query<{ id: string }>(
        `INSERT INTO keg_owners (name, code)
         VALUES ($1, $2)
         RETURNING id`,
        [`Deposit schema owner ${suffix}`, `dep-${suffix.slice(0, 12)}`],
      );

      const { rows } = await db.query<{
        id: string;
        keg_owner_id: string;
        selling_format_id: string;
        deposit_amount: string;
      }>(
        `INSERT INTO keg_owner_deposits (keg_owner_id, selling_format_id, deposit_amount)
         VALUES ($1, $2, $3)
         RETURNING id, keg_owner_id, selling_format_id, deposit_amount`,
        [owners[0]!.id, formats[0]!.id, 42.5],
      );

      expect(rows[0]).toMatchObject({
        keg_owner_id: owners[0]!.id,
        selling_format_id: formats[0]!.id,
        deposit_amount: "42.50",
      });

      // The uniqueness contract moved with the key: a second override for the
      // same owner + format must be rejected, not silently duplicated.
      await expect(
        db.query(
          `INSERT INTO keg_owner_deposits (keg_owner_id, selling_format_id, deposit_amount)
           VALUES ($1, $2, $3)`,
          [owners[0]!.id, formats[0]!.id, 99],
        ),
      ).rejects.toThrow(/uq_keg_owner_deposits_owner_format/);
    });
  });

  it("has no legacy keg_type_id contract and is unique per owner + format", async () => {
    await withRoleClient("admin", async (db) => {
      const { rows: columns } = await db.query<{
        column_name: string;
        is_nullable: "YES" | "NO";
      }>(
        `SELECT column_name, is_nullable
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'keg_owner_deposits'
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
            AND tablename = 'keg_owner_deposits'
            AND indexname = 'uq_keg_owner_deposits_owner_format'`,
      );

      expect(indexes).toHaveLength(1);
      expect(indexes[0]!.indexdef).toContain(
        "(keg_owner_id, selling_format_id)",
      );
      expect(indexes[0]!.indexdef).not.toContain("keg_type_id");
    });
  });
});
