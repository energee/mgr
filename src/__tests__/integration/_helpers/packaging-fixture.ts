/**
 * Shared packaging-session fixture builder for integration tests.
 *
 * Seeds the parent chain every packaging/finished-goods test needs before it
 * can exercise a trigger or RPC:
 *
 *   brand -> container -> selling_format -> batch(es)
 *          -> packaging_session (in_progress) -> session_line_item(s)
 *
 * and, optionally, a location + bin so the finished-goods placement mirror has
 * somewhere to write.
 *
 * ## Why this exists
 *
 * Before this helper, every suite that needed a completable packaging session
 * hand-rolled ~40 lines of INSERTs (see the `seedPackagingFixture` /
 * `seedKegFixture` pair still inlined in packaging-completion-trigger.test.ts).
 * That is the fixture gap backlog item 21 (TC-1) is about: the cost of the seed
 * was high enough that whole DB behaviors went untested rather than tested
 * badly.
 *
 * `packaging-completion-trigger.test.ts` deliberately still carries its own
 * copies. It is long-standing passing coverage of the exact ids and offsets it
 * seeds, and rewriting it to route through this helper would risk that coverage
 * for no behavioral gain. New suites should use this helper.
 *
 * ## Container type is the branch that matters
 *
 * `create_finished_goods_from_packaging` and `revise_packaging_session` both
 * branch on `containers.type = 'keg'` when deciding whether to write keg
 * transactions, so the container shape is a first-class option here rather than
 * something callers patch afterwards.
 *
 * ## Id namespacing
 *
 * Callers pass their own `uid(n)` so each suite keeps a private UUID range and
 * concurrently-running suites cannot collide even before their transactions
 * roll back. Ids are allocated at fixed offsets from `base`:
 *
 *   base+1 brand   base+2 container   base+3 selling format   base+4 session
 *   base+5 location            base+6 bin
 *   base+10+i batch i          base+30+i line item i
 *
 * Keep `base` values at least 100 apart, and avoid reusing base+1..base+40 for
 * ad-hoc ids in the calling test.
 *
 * Every caller is expected to run inside BEGIN/ROLLBACK; this helper commits
 * nothing itself.
 */

import type { PoolClient } from "pg";

/** Planned/actual quantity pair for one seeded `session_line_items` row. */
export type PackagingLineSpec = {
  planned: number;
  actual: number;
}

/** Container shape — the `containers.type = 'keg'` branch is load-bearing. */
export type PackagingContainerSpec =
  | { type: "package"; volumeOz?: number }
  | { type: "keg"; volumeBbl?: number };

export type PackagingFixtureOptions = {
  /** Offset for this fixture's id range. Space callers at least 100 apart. */
  base: number;
  /** Suite-private UUID builder, e.g. `n => \`...-0921-0002${pad(n)}\``. */
  uid: (n: number) => string;
  /** Human label woven into seeded names to keep them unique and greppable. */
  label?: string;
  /** Defaults to a 16 oz package container. */
  container?: PackagingContainerSpec;
  /** `selling_formats.unit_count`. Defaults to 4 for packages, 1 for kegs. */
  unitCount?: number;
  /** One batch + line item per entry. Defaults to a single 100-planned/96-actual line. */
  lines?: PackagingLineSpec[];
  /** Also seed a location + bin (needed by the bin-placement mirror). */
  withBin?: boolean;
}

export type PackagingFixture = {
  brandId: string;
  containerId: string;
  formatId: string;
  sessionId: string;
  /** One per entry in `lines`, index-aligned. */
  batchIds: string[];
  /** One per entry in `lines`, index-aligned. */
  lineIds: string[];
  /** Present only when `withBin` was set. */
  locationId?: string;
  binId?: string;
}

/**
 * Seeds a packaging session and its parent chain. See the module docstring for
 * the id layout and the reason container type is an option.
 */
export async function seedPackagingSession(
  client: PoolClient,
  options: PackagingFixtureOptions,
): Promise<PackagingFixture> {
  const {
    base,
    uid,
    label = `fixture ${base}`,
    container = { type: "package" as const },
    lines = [{ planned: 100, actual: 96 }],
    withBin = false,
  } = options;

  if (lines.length === 0) {
    throw new Error("seedPackagingSession: at least one line spec is required");
  }

  const brandId = uid(base + 1);
  const containerId = uid(base + 2);
  const formatId = uid(base + 3);
  const sessionId = uid(base + 4);
  const locationId = uid(base + 5);
  const binId = uid(base + 6);
  const batchIds = lines.map((_, i) => uid(base + 10 + i));
  const lineIds = lines.map((_, i) => uid(base + 30 + i));

  const unitCount = options.unitCount ?? (container.type === "keg" ? 1 : 4);

  await client.query(`INSERT INTO brands (id, name) VALUES ($1, $2)`, [
    brandId,
    `Brand ${label}`,
  ]);

  if (container.type === "keg") {
    await client.query(
      `INSERT INTO containers (id, name, type, volume_bbl)
       VALUES ($1, $2, 'keg', $3)`,
      [containerId, `Keg ${label}`, container.volumeBbl ?? 0.5],
    );
  } else {
    await client.query(
      `INSERT INTO containers (id, name, type, volume_oz)
       VALUES ($1, $2, 'package', $3)`,
      [containerId, `Package ${label}`, container.volumeOz ?? 16],
    );
  }

  await client.query(
    `INSERT INTO selling_formats (id, container_id, name, unit_count)
     VALUES ($1, $2, $3, $4)`,
    [formatId, containerId, `Format ${label}`, unitCount],
  );

  // One batch per line so a per-line revision cannot be masked by two lines
  // sharing a source batch.
  for (const [i, batchId] of batchIds.entries()) {
    await client.query(
      `INSERT INTO batches (id, batch_code, name, status, volume_bbl)
       VALUES ($1, $2, $3, 'packaging', 10)`,
      [batchId, `FIXT-${base}-${i}`, `Batch ${label} #${i}`],
    );
  }

  if (withBin) {
    await client.query(`INSERT INTO locations (id, name) VALUES ($1, $2)`, [
      locationId,
      `Location ${label}`,
    ]);
    await client.query(
      `INSERT INTO bins (id, location_id, name) VALUES ($1, $2, $3)`,
      [binId, locationId, `Bin ${label}`],
    );
  }

  await client.query(
    `INSERT INTO packaging_sessions (id, status, session_date)
     VALUES ($1, 'in_progress', CURRENT_DATE)`,
    [sessionId],
  );

  for (const [i, lineId] of lineIds.entries()) {
    await client.query(
      `INSERT INTO session_line_items
         (id, session_id, brand_id, selling_format_id, batch_id,
          planned_quantity, actual_quantity)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        lineId,
        sessionId,
        brandId,
        formatId,
        batchIds[i],
        lines[i].planned,
        lines[i].actual,
      ],
    );
  }

  return {
    brandId,
    containerId,
    formatId,
    sessionId,
    batchIds,
    lineIds,
    ...(withBin ? { locationId, binId } : {}),
  };
}

/**
 * Flips a seeded session to `completed`, firing
 * `on_packaging_session_completion` -> `create_finished_goods_from_packaging`.
 *
 * Returns the finished-goods row created for each line item, index-aligned with
 * the fixture's `lineIds`, so callers can assert against a specific line's lot
 * without re-querying.
 */
export async function completePackagingSession(
  client: PoolClient,
  fixture: PackagingFixture,
): Promise<Array<{ id: string; quantity: number; lotNumber: string }>> {
  await client.query(
    `UPDATE packaging_sessions SET status = 'completed' WHERE id = $1`,
    [fixture.sessionId],
  );

  const results: Array<{ id: string; quantity: number; lotNumber: string }> = [];
  for (const lineId of fixture.lineIds) {
    const res = await client.query<{
      id: string;
      quantity: number;
      lot_number: string;
    }>(
      `SELECT id, quantity, lot_number FROM finished_goods
       WHERE session_line_item_id = $1`,
      [lineId],
    );
    if (res.rows.length !== 1) {
      throw new Error(
        `completePackagingSession: expected exactly one finished good for line ` +
          `${lineId}, got ${res.rows.length}`,
      );
    }
    results.push({
      id: res.rows[0].id,
      quantity: res.rows[0].quantity,
      lotNumber: res.rows[0].lot_number,
    });
  }
  return results;
}
