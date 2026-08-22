/**
 * Behavioral coverage for the bin-inventory RPCs (backlog item 21 / TC-2).
 *
 * These two SECURITY DEFINER functions are the *second* writer to
 * `bin_inventory` (the first being the 00219 placement/revise mirror), and they
 * are what the Square sale and refund webhook arms call on every POS event.
 * Until now they had zero behavioral coverage.
 *
 *  - `debit_bin_inventory(p_bin_id, p_finished_good_id, p_qty)`
 *      RETURNS TABLE(new_quantity integer, clamped boolean)
 *    Row-locks the bin's FG row (FOR UPDATE) and decrements it, clamping at
 *    zero via GREATEST(0, old - qty). `clamped` is the oversell signal the
 *    webhook flags on: it is true iff the sale exceeded the physical count.
 *    The boundary that matters is an EXACT sellout — old = qty lands the row at
 *    0 but is NOT a clamp, because nothing was oversold. A test that only
 *    checked "quantity hit zero" would not tell those two apart, which is the
 *    whole point of the flag.
 *
 *  - `credit_bin_inventory(p_bin_id, p_finished_good_id, p_qty)`
 *      RETURNS TABLE(new_quantity integer)
 *    Upserts, accumulating onto an existing (finished_good_id, bin_id) row.
 *
 * Both refuse a non-positive / negative quantity rather than silently inverting
 * the operation: a negative debit would CREDIT the bin through the GREATEST(),
 * which 00232 called out explicitly.
 *
 * The clamp is also what keeps `chk_bin_inventory_quantity_nonneg` (00239)
 * satisfiable — an unclamped oversell would violate the CHECK — so the
 * persisted-value assertions below are load-bearing, not cosmetic.
 *
 * All tests run inside BEGIN/ROLLBACK; nothing is committed.
 */

import { afterAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { requireDatabaseUrl } from "./_helpers/role-client";

const pool = new Pool({ connectionString: requireDatabaseUrl() });

/** Deterministic UUID namespace for this suite: backlog item 0921, sub-range 0001. */
function uid(n: number): string {
  return `00000000-0000-0000-0921-0001${String(n).padStart(8, "0")}`;
}

afterAll(async () => {
  await pool.end();
});

type BinFixture = {
  binId: string;
  altBinId: string;
  fgId: string;
  otherFgId: string;
}

/**
 * Seeds a location, two bins, a brand and two finished goods.
 *
 * Two bins and two finished goods so the "touches only the addressed pair"
 * assertions have something to be wrong about — a debit keyed on the wrong
 * column would otherwise pass silently.
 *
 * Neither bin sets `is_default_fg`, so the `place_finished_good_in_bin`
 * insert trigger declines to auto-place (it emits a NOTICE and returns). Every
 * `bin_inventory` row in this suite is therefore one the test wrote itself.
 */
async function seedBins(client: PoolClient, base: number): Promise<BinFixture> {
  const locationId = uid(base + 1);
  const binId = uid(base + 2);
  const altBinId = uid(base + 3);
  const brandId = uid(base + 4);
  const fgId = uid(base + 5);
  const otherFgId = uid(base + 6);

  await client.query(`INSERT INTO locations (id, name) VALUES ($1, $2)`, [
    locationId,
    `Bin clamp location ${base}`,
  ]);
  await client.query(
    `INSERT INTO bins (id, location_id, name) VALUES ($1, $2, $3), ($4, $2, $5)`,
    [binId, locationId, `Clamp bin ${base}`, altBinId, `Clamp alt bin ${base}`],
  );
  await client.query(`INSERT INTO brands (id, name) VALUES ($1, $2)`, [
    brandId,
    `Bin clamp brand ${base}`,
  ]);
  await client.query(
    `INSERT INTO finished_goods (id, brand_id, quantity, lot_number)
     VALUES ($1, $2, 500, $3), ($4, $2, 500, $5)`,
    [fgId, brandId, `CLAMP-${base}-A`, otherFgId, `CLAMP-${base}-B`],
  );

  return { binId, altBinId, fgId, otherFgId };
}

/** Puts `qty` of `fgId` into `binId`. */
async function stock(
  client: PoolClient,
  binId: string,
  fgId: string,
  qty: number,
): Promise<void> {
  await client.query(
    `INSERT INTO bin_inventory (bin_id, finished_good_id, quantity) VALUES ($1, $2, $3)`,
    [binId, fgId, qty],
  );
}

/** Reads the persisted quantity for a pair, or null when no row exists. */
async function readQty(
  client: PoolClient,
  binId: string,
  fgId: string,
): Promise<number | null> {
  const res = await client.query<{ quantity: number }>(
    `SELECT quantity FROM bin_inventory WHERE bin_id = $1 AND finished_good_id = $2`,
    [binId, fgId],
  );
  return res.rows.length === 0 ? null : res.rows[0].quantity;
}

async function debit(
  client: PoolClient,
  binId: string,
  fgId: string,
  qty: number,
): Promise<{ new_quantity: number; clamped: boolean }> {
  const res = await client.query<{ new_quantity: number; clamped: boolean }>(
    `SELECT new_quantity, clamped FROM debit_bin_inventory($1, $2, $3)`,
    [binId, fgId, qty],
  );
  return res.rows[0];
}

/** Runs `fn` against a fresh transaction that is always rolled back. */
async function inTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    return await fn(client);
  } finally {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Transaction may already be aborted; nothing to salvage.
    }
    client.release();
  }
}

describe("debit_bin_inventory clamp (00223/00232)", () => {
  it("decrements by the requested quantity and reports no clamp", async () => {
    await inTx(async (client) => {
      const { binId, fgId } = await seedBins(client, 100);
      await stock(client, binId, fgId, 10);

      const result = await debit(client, binId, fgId, 3);

      expect(result).toEqual({ new_quantity: 7, clamped: false });
      expect(await readQty(client, binId, fgId)).toBe(7);
    });
  });

  it("treats an exact sellout as zero WITHOUT flagging a clamp", async () => {
    // The boundary the `clamped` flag exists to distinguish: landing on zero
    // because the sale consumed exactly what was there is not an oversell.
    await inTx(async (client) => {
      const { binId, fgId } = await seedBins(client, 200);
      await stock(client, binId, fgId, 8);

      const result = await debit(client, binId, fgId, 8);

      expect(result).toEqual({ new_quantity: 0, clamped: false });
      expect(await readQty(client, binId, fgId)).toBe(0);
    });
  });

  it("clamps an oversell to zero and flags it", async () => {
    await inTx(async (client) => {
      const { binId, fgId } = await seedBins(client, 300);
      await stock(client, binId, fgId, 8);

      // One more than the bin holds is enough to be an oversell.
      const justOver = await debit(client, binId, fgId, 9);
      expect(justOver).toEqual({ new_quantity: 0, clamped: true });
      expect(await readQty(client, binId, fgId)).toBe(0);
    });
  });

  it("clamps at zero rather than going negative on a large oversell", async () => {
    // Without the GREATEST(0, ...) this would write -42 and trip
    // chk_bin_inventory_quantity_nonneg (00239).
    await inTx(async (client) => {
      const { binId, fgId } = await seedBins(client, 400);
      await stock(client, binId, fgId, 8);

      const result = await debit(client, binId, fgId, 50);

      expect(result).toEqual({ new_quantity: 0, clamped: true });
      expect(await readQty(client, binId, fgId)).toBe(0);
    });
  });

  it("is a no-op for a zero-quantity debit", async () => {
    await inTx(async (client) => {
      const { binId, fgId } = await seedBins(client, 500);
      await stock(client, binId, fgId, 6);

      const result = await debit(client, binId, fgId, 0);

      expect(result).toEqual({ new_quantity: 6, clamped: false });
      expect(await readQty(client, binId, fgId)).toBe(6);
    });
  });

  it("refuses a negative quantity instead of silently crediting the bin", async () => {
    // GREATEST(0, 6 - (-4)) = 10 — a negative debit would ADD stock.
    await inTx(async (client) => {
      const { binId, fgId } = await seedBins(client, 600);
      await stock(client, binId, fgId, 6);

      await client.query("SAVEPOINT before_negative");
      await expect(debit(client, binId, fgId, -4)).rejects.toThrow(
        /p_qty must be >= 0/,
      );
      await client.query("ROLLBACK TO SAVEPOINT before_negative");

      expect(await readQty(client, binId, fgId)).toBe(6);
    });
  });

  it("reports a full clamp and creates no row when the pair is not stocked", async () => {
    // Defensive path: the webhook only calls this for a row it just read, so a
    // miss means a concurrent delete. It must not resurrect the row.
    await inTx(async (client) => {
      const { binId, fgId } = await seedBins(client, 700);

      const result = await debit(client, binId, fgId, 5);

      expect(result).toEqual({ new_quantity: 0, clamped: true });
      expect(await readQty(client, binId, fgId)).toBeNull();
    });
  });

  it("does not flag a clamp when an unstocked pair is debited by zero", async () => {
    await inTx(async (client) => {
      const { binId, fgId } = await seedBins(client, 800);

      const result = await debit(client, binId, fgId, 0);

      expect(result).toEqual({ new_quantity: 0, clamped: false });
      expect(await readQty(client, binId, fgId)).toBeNull();
    });
  });

  it("debits only the addressed (bin, finished_good) pair", async () => {
    await inTx(async (client) => {
      const { binId, altBinId, fgId, otherFgId } = await seedBins(client, 900);
      await stock(client, binId, fgId, 10);
      await stock(client, altBinId, fgId, 10);
      await stock(client, binId, otherFgId, 10);

      await debit(client, binId, fgId, 4);

      expect(await readQty(client, binId, fgId)).toBe(6);
      // Same finished good in a different bin, and a different finished good in
      // the same bin, are both untouched.
      expect(await readQty(client, altBinId, fgId)).toBe(10);
      expect(await readQty(client, binId, otherFgId)).toBe(10);
    });
  });

  it("accumulates successive debits down to the clamp", async () => {
    await inTx(async (client) => {
      const { binId, fgId } = await seedBins(client, 1000);
      await stock(client, binId, fgId, 10);

      expect(await debit(client, binId, fgId, 4)).toEqual({
        new_quantity: 6,
        clamped: false,
      });
      expect(await debit(client, binId, fgId, 4)).toEqual({
        new_quantity: 2,
        clamped: false,
      });
      // The third sale is the one that oversells.
      expect(await debit(client, binId, fgId, 4)).toEqual({
        new_quantity: 0,
        clamped: true,
      });
      expect(await readQty(client, binId, fgId)).toBe(0);
    });
  });
});

describe("credit_bin_inventory (00223, refund arm 00241)", () => {
  it("creates the bin row when the pair is not yet stocked", async () => {
    await inTx(async (client) => {
      const { binId, fgId } = await seedBins(client, 1100);

      const res = await client.query<{ new_quantity: number }>(
        `SELECT new_quantity FROM credit_bin_inventory($1, $2, $3)`,
        [binId, fgId, 7],
      );

      expect(res.rows[0].new_quantity).toBe(7);
      expect(await readQty(client, binId, fgId)).toBe(7);
    });
  });

  it("accumulates onto an existing bin row", async () => {
    await inTx(async (client) => {
      const { binId, fgId } = await seedBins(client, 1200);
      await stock(client, binId, fgId, 5);

      const res = await client.query<{ new_quantity: number }>(
        `SELECT new_quantity FROM credit_bin_inventory($1, $2, $3)`,
        [binId, fgId, 4],
      );

      expect(res.rows[0].new_quantity).toBe(9);
      expect(await readQty(client, binId, fgId)).toBe(9);
    });
  });

  it.each([
    ["zero", 0],
    ["negative", -3],
  ])("refuses a %s quantity", async (_label, qty) => {
    await inTx(async (client) => {
      const { binId, fgId } = await seedBins(client, 1300);
      await stock(client, binId, fgId, 5);

      await client.query("SAVEPOINT before_bad_credit");
      await expect(
        client.query(`SELECT new_quantity FROM credit_bin_inventory($1, $2, $3)`, [
          binId,
          fgId,
          qty,
        ]),
      ).rejects.toThrow(/quantity must be positive/);
      await client.query("ROLLBACK TO SAVEPOINT before_bad_credit");

      expect(await readQty(client, binId, fgId)).toBe(5);
    });
  });

  it("refuses a NULL quantity", async () => {
    await inTx(async (client) => {
      const { binId, fgId } = await seedBins(client, 1400);

      await client.query("SAVEPOINT before_null_credit");
      await expect(
        client.query(`SELECT new_quantity FROM credit_bin_inventory($1, $2, $3)`, [
          binId,
          fgId,
          null,
        ]),
      ).rejects.toThrow(/quantity must be positive/);
      await client.query("ROLLBACK TO SAVEPOINT before_null_credit");

      expect(await readQty(client, binId, fgId)).toBeNull();
    });
  });

  it("restores a clamped oversell without resurrecting the lost units", async () => {
    // The refund arm (00241) credits back what the sale said it sold. After an
    // oversell the bin was clamped to 0, so a refund of the full sale quantity
    // leaves MORE in the bin than the clamp took out. Pinning this because it is
    // the asymmetry that makes clamped sales worth flagging in the first place.
    await inTx(async (client) => {
      const { binId, fgId } = await seedBins(client, 1500);
      await stock(client, binId, fgId, 3);

      // Sold 5 against a physical count of 3: bin clamps to 0, 2 units oversold.
      expect(await debit(client, binId, fgId, 5)).toEqual({
        new_quantity: 0,
        clamped: true,
      });

      // Full refund of the 5 credits 5 back — not 3.
      const res = await client.query<{ new_quantity: number }>(
        `SELECT new_quantity FROM credit_bin_inventory($1, $2, $3)`,
        [binId, fgId, 5],
      );
      expect(res.rows[0].new_quantity).toBe(5);
      expect(await readQty(client, binId, fgId)).toBe(5);
    });
  });
});
