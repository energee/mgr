/**
 * Behavioral coverage for keg receive -> fill -> ship netting (backlog item 21 / TC-10).
 *
 * The keg fleet has no balance table and no balance function: every number the
 * app shows is netted on read by a view over `keg_transactions`.
 *
 *  - `keg_inventory` — the fleet ledger. Nets each leg as an inflow at
 *    (to_state, to_location_id) and an outflow at (from_state,
 *    from_location_id), grouped by (selling_format, keg_owner, state,
 *    location), with `HAVING sum(qty) > 0`.
 *  - `keg_filled_contents` — the per-lot/bin filled pool the FIFO ship draw
 *    reads. Owner-blind by design.
 *  - `customer_keg_balances` — deposits: `+qty` on ship, `-qty` on return.
 *
 * That `HAVING sum > 0` is the reason this needs behavioral tests rather than
 * shape tests: when a leg's outflow lands in a group no inflow ever deposited
 * into, the negative is silently DROPPED instead of making the total go
 * negative, so **the fleet inflates and nothing errors**. Migrations 00228,
 * 00229, 00232, 00234 and 00238 are all repairs of that one failure mode. The
 * only way to catch a regression is to assert the conserved total: kegs
 * received must equal empty + filled + shipped, always.
 *
 * The 00238 case is the sharpest: `keg_owner_id` carries two different meanings
 * (which owner's physical kegs are in this state, vs. whose keg the customer
 * owes a deposit on). Fill legs stamp the packaging line's owner — often NULL,
 * because operators leave the picker blank — while ship legs stamp the order
 * line's owner. 00238 re-attributes filled-state legs to the fill owner **for
 * fleet netting only**, leaving deposits keyed on the raw stamp. Both halves are
 * asserted below.
 *
 * ## Known-broken fixture dependency — see issue #917
 *
 * `seedEnumRegistry` below inserts `enum_values` rows that the migration chain
 * should already provide. On a from-scratch database the registry's
 * `keg_transaction_type` vocabulary does not match the Postgres enum, so the
 * 00040 `validate_enum_value` trigger rejects `receive` and `ship` outright and
 * this entire scenario is unreachable. That is a real defect (filed as #917),
 * not a test-setup detail: DELETE `seedEnumRegistry` once #917 is fixed, and if
 * these tests then fail, the fix is incomplete.
 *
 * All tests run inside BEGIN/ROLLBACK; nothing is committed.
 */

import { afterAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { requireDatabaseUrl } from "./_helpers/role-client";

const pool = new Pool({ connectionString: requireDatabaseUrl() });

/** Deterministic UUID namespace for this suite: backlog item 0921, sub-range 0003. */
function uid(n: number): string {
  return `00000000-0000-0000-0921-0003${String(n).padStart(8, "0")}`;
}

afterAll(async () => {
  await pool.end();
});

/**
 * Repairs the `enum_values` registry so `receive` and `ship` are insertable.
 *
 * COMPENSATING FOR A REAL BUG — see issue #917 and the module docstring. This
 * is not normal fixture setup; remove it when #917 lands.
 */
async function seedEnumRegistry(client: PoolClient): Promise<void> {
  await client.query(
    `INSERT INTO enum_values (enum_type, value, label, sort_order, is_active)
     VALUES ('keg_transaction_type','receive','Receive',5,TRUE),
            ('keg_transaction_type','ship','Ship',25,TRUE),
            ('keg_transaction_type','clean','Clean',45,TRUE)
     ON CONFLICT DO NOTHING`,
  );
}

type KegFixture = {
  locationId: string;
  binId: string;
  brandId: string;
  containerId: string;
  formatId: string;
  ownerId: string;
  kegTypeId: string;
  customerId: string;
  sessionId: string;
  fgId: string;
}

/** Deposit per keg on the seeded container; drives customer_keg_balances. */
const DEPOSIT_PER_KEG = 30;

/**
 * Seeds the full parent chain for a keg scenario: location + bin, brand,
 * keg container + selling format, keg owner, keg type, customer, packaging
 * session and one finished-goods lot.
 *
 * `keg_types` exists only to satisfy `chk_order_item_keg_owner`
 * (`keg_owner_id IS NULL OR keg_type_id IS NOT NULL`) — the netting itself keys
 * off `selling_format_id`.
 */
async function seedKegScenario(
  client: PoolClient,
  base: number,
): Promise<KegFixture> {
  await seedEnumRegistry(client);

  const fx: KegFixture = {
    locationId: uid(base + 1),
    binId: uid(base + 2),
    brandId: uid(base + 3),
    containerId: uid(base + 4),
    formatId: uid(base + 5),
    ownerId: uid(base + 6),
    kegTypeId: uid(base + 7),
    customerId: uid(base + 8),
    sessionId: uid(base + 9),
    fgId: uid(base + 10),
  };

  await client.query(`INSERT INTO locations (id, name) VALUES ($1, $2)`, [
    fx.locationId,
    `Keg location ${base}`,
  ]);
  await client.query(
    `INSERT INTO bins (id, location_id, name) VALUES ($1, $2, $3)`,
    [fx.binId, fx.locationId, `Keg bin ${base}`],
  );
  await client.query(`INSERT INTO brands (id, name) VALUES ($1, $2)`, [
    fx.brandId,
    `Keg brand ${base}`,
  ]);
  // containers.type = 'keg' is what every keg branch in the DB switches on.
  await client.query(
    `INSERT INTO containers (id, name, type, volume_bbl, deposit_amount)
     VALUES ($1, $2, 'keg', 0.5, $3)`,
    [fx.containerId, `Keg half barrel ${base}`, DEPOSIT_PER_KEG],
  );
  await client.query(
    `INSERT INTO selling_formats (id, container_id, name, unit_count)
     VALUES ($1, $2, $3, 1)`,
    [fx.formatId, fx.containerId, `Keg format ${base}`],
  );
  await client.query(
    `INSERT INTO keg_owners (id, name, code) VALUES ($1, $2, $3)`,
    [fx.ownerId, `Keg owner ${base}`, `KO${base}`],
  );
  await client.query(
    `INSERT INTO keg_types (id, name, code, volume_bbl, deposit_amount, show_in_pricing)
     VALUES ($1, $2, $3, 0.5, $4, true)`,
    [fx.kegTypeId, `Keg type ${base}`, `KT${base}`, DEPOSIT_PER_KEG],
  );
  await client.query(
    `INSERT INTO customers (id, name, customer_type) VALUES ($1, $2, 'wholesale')`,
    [fx.customerId, `Keg customer ${base}`],
  );
  await client.query(
    `INSERT INTO packaging_sessions (id, status, session_date, default_bin_id)
     VALUES ($1, 'planned', CURRENT_DATE, $2)`,
    [fx.sessionId, fx.binId],
  );
  await client.query(
    `INSERT INTO finished_goods
       (id, brand_id, quantity, lot_number, production_date, selling_format_id)
     VALUES ($1, $2, 20, $3, CURRENT_DATE - 5, $4)`,
    [fx.fgId, fx.brandId, `KEG-LOT-${base}`, fx.formatId],
  );

  return fx;
}

/** Records a keg receive. `from_state`/`to_state` are set by the DB trigger. */
async function receiveKegs(
  client: PoolClient,
  fx: KegFixture,
  qty: number,
  ownerId: string | null = fx.ownerId,
): Promise<void> {
  await client.query(
    `INSERT INTO keg_transactions
       (transaction_type, selling_format_id, keg_owner_id, quantity,
        to_location_id, to_bin_id)
     VALUES ('receive', $1, $2, $3, $4, $5)`,
    [fx.formatId, ownerId, qty, fx.locationId, fx.binId],
  );
}

/**
 * Records a keg fill.
 *
 * `from_location_id` is stamped as well as `to_location_id` (00232): without
 * it the empty-pool outflow lands in a NULL-location group that no receive
 * deposited into, and `HAVING sum > 0` silently drops it — the empties never
 * decrement.
 */
async function fillKegs(
  client: PoolClient,
  fx: KegFixture,
  qty: number,
  ownerId: string | null = fx.ownerId,
): Promise<void> {
  await client.query(
    `INSERT INTO keg_transactions
       (transaction_type, selling_format_id, keg_owner_id, quantity,
        finished_good_id, packaging_session_id,
        from_location_id, to_location_id, to_bin_id)
     VALUES ('fill', $1, $2, $3, $4, $5, $6, $6, $7)`,
    [fx.formatId, ownerId, qty, fx.fgId, fx.sessionId, fx.locationId, fx.binId],
  );
}

/**
 * Creates a keg order and walks it to `fulfilled`, which fires
 * `create_keg_ship_transactions_from_order`.
 *
 * `validate_state_transition` enforces the whole walk — draft -> confirmed ->
 * scheduled -> picking -> packed -> fulfilled — so the intermediate updates are
 * required, not ceremony.
 */
async function shipViaOrder(
  client: PoolClient,
  fx: KegFixture,
  orderId: string,
  qty: number,
  ownerId: string | null = fx.ownerId,
): Promise<void> {
  await client.query(
    `INSERT INTO orders (id, customer_id, status) VALUES ($1, $2, 'draft')`,
    [orderId, fx.customerId],
  );
  await client.query(
    `INSERT INTO order_items
       (order_id, quantity, brand_id, keg_owner_id, keg_type_id, selling_format_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [orderId, qty, fx.brandId, ownerId, fx.kegTypeId, fx.formatId],
  );
  for (const status of [
    "confirmed",
    "scheduled",
    "picking",
    "packed",
    "fulfilled",
  ]) {
    await client.query(`UPDATE orders SET status = $2 WHERE id = $1`, [
      orderId,
      status,
    ]);
  }
}

/** Fleet totals per state for one selling format, summed across owners. */
async function fleetByState(
  client: PoolClient,
  formatId: string,
): Promise<Record<string, number>> {
  const res = await client.query<{ state: string; qty: string }>(
    `SELECT state, sum(quantity)::text AS qty
     FROM keg_inventory WHERE selling_format_id = $1 GROUP BY state`,
    [formatId],
  );
  return Object.fromEntries(res.rows.map((r) => [r.state, Number(r.qty)]));
}

/** Units sitting in the filled pool for one finished-goods lot. */
async function filledContents(
  client: PoolClient,
  fgId: string,
): Promise<number> {
  const res = await client.query<{ qty: string | null }>(
    `SELECT COALESCE(sum(quantity), 0)::text AS qty
     FROM keg_filled_contents WHERE finished_good_id = $1`,
    [fgId],
  );
  return Number(res.rows[0].qty);
}

async function inTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    return await fn(client);
  } finally {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Transaction may already be aborted.
    }
    client.release();
  }
}

describe("keg receive -> fill -> ship netting", () => {
  it("puts received kegs into the empty pool", async () => {
    await inTx(async (client) => {
      const fx = await seedKegScenario(client, 100);
      await receiveKegs(client, fx, 50);

      expect(await fleetByState(client, fx.formatId)).toEqual({ empty: 50 });
      expect(await filledContents(client, fx.fgId)).toBe(0);
    });
  });

  it("moves kegs from empty to filled on a fill, conserving the fleet", async () => {
    await inTx(async (client) => {
      const fx = await seedKegScenario(client, 200);
      await receiveKegs(client, fx, 50);
      await fillKegs(client, fx, 20);

      // 50 received = 30 empty + 20 filled. If the empty outflow were stranded
      // this would read { empty: 50, filled: 20 } and total 70.
      expect(await fleetByState(client, fx.formatId)).toEqual({
        empty: 30,
        filled: 20,
      });
      expect(await filledContents(client, fx.fgId)).toBe(20);
    });
  });

  it("moves kegs from filled to shipped on order fulfillment", async () => {
    await inTx(async (client) => {
      const fx = await seedKegScenario(client, 300);
      await receiveKegs(client, fx, 50);
      await fillKegs(client, fx, 20);
      await shipViaOrder(client, fx, uid(399), 12);

      const fleet = await fleetByState(client, fx.formatId);
      expect(fleet).toEqual({ empty: 30, filled: 8, shipped: 12 });
      // The conservation invariant this whole suite exists to protect.
      expect(fleet.empty + fleet.filled + fleet.shipped).toBe(50);

      // The filled pool drained by exactly what shipped.
      expect(await filledContents(client, fx.fgId)).toBe(8);
    });
  });

  it("copies the drawn lot and bin onto the ship leg rather than deriving them", async () => {
    // 00229: the ship leg carries the contents it drew, so the filled pool nets
    // against the same (finished_good, bin) group the fill deposited into.
    await inTx(async (client) => {
      const fx = await seedKegScenario(client, 400);
      await receiveKegs(client, fx, 50);
      await fillKegs(client, fx, 20);
      await shipViaOrder(client, fx, uid(499), 12);

      const res = await client.query<{
        quantity: number;
        from_state: string;
        to_state: string;
        finished_good_id: string;
        from_bin_id: string;
      }>(
        `SELECT quantity, from_state, to_state, finished_good_id, from_bin_id
         FROM keg_transactions
         WHERE transaction_type = 'ship' AND selling_format_id = $1`,
        [fx.formatId],
      );

      expect(res.rows).toEqual([
        {
          quantity: 12,
          from_state: "filled",
          to_state: "shipped",
          finished_good_id: fx.fgId,
          from_bin_id: fx.binId,
        },
      ]);
    });
  });

  it("charges the customer a deposit for every shipped keg", async () => {
    await inTx(async (client) => {
      const fx = await seedKegScenario(client, 500);
      await receiveKegs(client, fx, 50);
      await fillKegs(client, fx, 20);
      await shipViaOrder(client, fx, uid(599), 12);

      const res = await client.query<{ kegs_out: string; deposit_value: string }>(
        `SELECT sum(kegs_out)::text AS kegs_out,
                sum(deposit_value)::text AS deposit_value
         FROM customer_keg_balances WHERE customer_id = $1`,
        [fx.customerId],
      );

      expect(Number(res.rows[0].kegs_out)).toBe(12);
      expect(Number(res.rows[0].deposit_value)).toBe(12 * DEPOSIT_PER_KEG);
    });
  });

  it("refuses to fulfill an order demanding more kegs than are filled", async () => {
    // 00229 raises rather than shipping short: a partial ship would leave the
    // filled pool and the order disagreeing with no error anywhere.
    await inTx(async (client) => {
      const fx = await seedKegScenario(client, 600);
      await receiveKegs(client, fx, 50);
      await fillKegs(client, fx, 5);

      await client.query("SAVEPOINT before_short_ship");
      await expect(shipViaOrder(client, fx, uid(699), 12)).rejects.toThrow();
      await client.query("ROLLBACK TO SAVEPOINT before_short_ship");

      // Nothing shipped; the filled pool is intact.
      expect(await fleetByState(client, fx.formatId)).toEqual({
        empty: 45,
        filled: 5,
      });
      expect(await filledContents(client, fx.fgId)).toBe(5);
    });
  });
});

describe("keg_owner re-attribution for fleet netting (00238)", () => {
  it("keeps the fleet conserved when the fill and ship owners disagree", async () => {
    // The live shape: the packaging operator left the owner picker blank, so
    // the fill legs are owner-NULL, while the order line names an owner.
    //
    // Pre-00238 the ship's -filled landed in the named-owner group, which no
    // fill had deposited into, so HAVING sum > 0 dropped it and the NULL-owner
    // filled pool never decremented: the fleet read 62 against 50 received.
    await inTx(async (client) => {
      const fx = await seedKegScenario(client, 700);
      await receiveKegs(client, fx, 50, null);
      await fillKegs(client, fx, 20, null);
      await shipViaOrder(client, fx, uid(799), 12, fx.ownerId);

      const fleet = await fleetByState(client, fx.formatId);
      expect(fleet).toEqual({ empty: 30, filled: 8, shipped: 12 });
      expect(fleet.empty + fleet.filled + fleet.shipped).toBe(50);
    });
  });

  it("nets the filled pool down even when the ship names a different owner", async () => {
    await inTx(async (client) => {
      const fx = await seedKegScenario(client, 800);
      await receiveKegs(client, fx, 50, null);
      await fillKegs(client, fx, 20, null);
      await shipViaOrder(client, fx, uid(899), 12, fx.ownerId);

      // keg_filled_contents is owner-blind, so it drains regardless.
      expect(await filledContents(client, fx.fgId)).toBe(8);
    });
  });

  it("still keys the customer deposit on the order's owner, not the fill owner", async () => {
    // The other half of 00238: re-attribution is for fleet grouping ONLY.
    // Deposits must follow the raw stamp, or the brewery bills the wrong owner.
    await inTx(async (client) => {
      const fx = await seedKegScenario(client, 900);
      await receiveKegs(client, fx, 50, null);
      await fillKegs(client, fx, 20, null);
      await shipViaOrder(client, fx, uid(999), 12, fx.ownerId);

      const res = await client.query<{ keg_owner_id: string; kegs_out: string }>(
        `SELECT keg_owner_id, kegs_out::text AS kegs_out
         FROM customer_keg_balances WHERE customer_id = $1`,
        [fx.customerId],
      );

      expect(res.rows).toEqual([
        { keg_owner_id: fx.ownerId, kegs_out: "12" },
      ]);
    });
  });
});
