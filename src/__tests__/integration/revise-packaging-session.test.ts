/**
 * Behavioral coverage for `revise_packaging_session` (backlog item 21 / TC-7).
 *
 * Signature:
 *   revise_packaging_session(p_session_id uuid, p_items jsonb, p_reason text)
 *     RETURNS jsonb  -- { lines_updated, fg_created, fg_updated,
 *                         allocations_inserted, allocations_reversed, shortfalls }
 *
 * This is the RPC behind "we counted wrong, fix the numbers after the fact". It
 * is a ~430-line plpgsql function that revalues finished goods, mirrors the
 * delta into bin inventory, re-drives BOM material consumption, rewrites keg
 * transactions, and finally flips the session to `revised` through a
 * transaction-local GUC handshake with `packaging_session_before_update()`.
 *
 * Before this file its only integration coverage was a single case in
 * packaging-completion-trigger.test.ts (rejecting a reduction below the
 * already-allocated total). Everything else — every input-validation branch,
 * the status flip itself, the audit note, and re-revision — was untested. The
 * status flip in particular is the mechanism behind the `revised` live outage
 * called out in backlog item 22, so it is pinned here explicitly.
 *
 * Each guard test drives the function to the *refusal* and then asserts the
 * rows are unchanged: a guard that blocks is only proven by an attempt to
 * violate it that gets refused and leaves nothing behind.
 *
 * All tests run inside BEGIN/ROLLBACK; nothing is committed.
 */

import { afterAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { requireDatabaseUrl } from "./_helpers/role-client";
import {
  completePackagingSession,
  seedPackagingSession,
  type PackagingFixture,
} from "./_helpers/packaging-fixture";

const pool = new Pool({ connectionString: requireDatabaseUrl() });

/** Deterministic UUID namespace for this suite: backlog item 0921, sub-range 0002. */
function uid(n: number): string {
  return `00000000-0000-0000-0921-0002${String(n).padStart(8, "0")}`;
}

afterAll(async () => {
  await pool.end();
});

type ReviseSummary = {
  lines_updated: number;
  fg_created: number;
  fg_updated: number;
  allocations_inserted: number;
  allocations_reversed: number;
  shortfalls: unknown[];
}

/** Calls the RPC and returns its JSONB summary. */
async function revise(
  client: PoolClient,
  sessionId: string,
  items: Array<Record<string, unknown>>,
  reason?: string,
): Promise<ReviseSummary> {
  const res = await client.query<{ revise_packaging_session: ReviseSummary }>(
    `SELECT revise_packaging_session($1, $2::jsonb, $3) AS revise_packaging_session`,
    [sessionId, JSON.stringify(items), reason ?? null],
  );
  return res.rows[0].revise_packaging_session;
}

/**
 * Asserts the RPC refuses this call, then restores the transaction.
 *
 * A raised plpgsql exception aborts the whole transaction, so every follow-up
 * "and nothing changed" assertion would otherwise fail with "current
 * transaction is aborted" rather than reporting what it meant to check. The
 * SAVEPOINT is what makes the post-refusal state readable.
 */
async function expectReviseRejected(
  client: PoolClient,
  sessionId: string,
  items: Array<Record<string, unknown>>,
  pattern: RegExp,
): Promise<void> {
  await client.query("SAVEPOINT before_revise");
  await expect(revise(client, sessionId, items)).rejects.toThrow(pattern);
  await client.query("ROLLBACK TO SAVEPOINT before_revise");
}

async function readSession(
  client: PoolClient,
  sessionId: string,
): Promise<{ status: string; notes: string | null }> {
  const res = await client.query<{ status: string; notes: string | null }>(
    `SELECT status, notes FROM packaging_sessions WHERE id = $1`,
    [sessionId],
  );
  return res.rows[0];
}

/** `session_line_items.actual_quantity` is NUMERIC (00288), so pg returns a string. */
async function readActual(
  client: PoolClient,
  lineId: string,
): Promise<string | null> {
  const res = await client.query<{ actual_quantity: string | null }>(
    `SELECT actual_quantity FROM session_line_items WHERE id = $1`,
    [lineId],
  );
  return res.rows[0].actual_quantity;
}

async function readFgQty(client: PoolClient, fgId: string): Promise<number> {
  const res = await client.query<{ quantity: number }>(
    `SELECT quantity FROM finished_goods WHERE id = $1`,
    [fgId],
  );
  return res.rows[0].quantity;
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

/** Seeds a fixture and completes it, so it is eligible for revision. */
async function seedCompleted(
  client: PoolClient,
  base: number,
  lines = [{ planned: 100, actual: 96 }],
): Promise<{
  fx: PackagingFixture;
  goods: Array<{ id: string; quantity: number; lotNumber: string }>;
}> {
  const fx = await seedPackagingSession(client, {
    base,
    uid,
    label: `revise ${base}`,
    lines,
  });
  const goods = await completePackagingSession(client, fx);
  return { fx, goods };
}

describe("revise_packaging_session — input guards", () => {
  it("rejects an unknown session id", async () => {
    await inTx(async (client) => {
      await expect(
        revise(client, uid(99), [{ line_item_id: uid(98), actual_quantity: 5 }]),
      ).rejects.toThrow(/not found/);
    });
  });

  it("refuses to revise a session that was never completed", async () => {
    await inTx(async (client) => {
      const fx = await seedPackagingSession(client, {
        base: 100,
        uid,
        label: "revise 100",
      });
      // Still in_progress — no finished goods exist to revalue.
      await expectReviseRejected(
        client,
        fx.sessionId,
        [{ line_item_id: fx.lineIds[0], actual_quantity: 5 }],
        /Only completed \(or previously revised\) sessions/,
      );

      expect((await readSession(client, fx.sessionId)).status).toBe("in_progress");
      expect(await readActual(client, fx.lineIds[0])).toBe("96");
    });
  });

  it("rejects an empty item list", async () => {
    await inTx(async (client) => {
      const { fx } = await seedCompleted(client, 200);

      await expectReviseRejected(
        client,
        fx.sessionId,
        [],
        /No quantity changes submitted/,
      );
      expect((await readSession(client, fx.sessionId)).status).toBe("completed");
    });
  });

  it("rejects an item with no line_item_id", async () => {
    await inTx(async (client) => {
      const { fx } = await seedCompleted(client, 300);

      await expectReviseRejected(
        client,
        fx.sessionId,
        [{ actual_quantity: 5 }],
        /must include line_item_id/,
      );
      expect((await readSession(client, fx.sessionId)).status).toBe("completed");
    });
  });

  it("rejects a line item belonging to a different session", async () => {
    // Cross-session write is the dangerous one: without this check a caller
    // could revalue another session's finished goods.
    await inTx(async (client) => {
      const { fx: target } = await seedCompleted(client, 400);
      const { fx: other, goods: otherGoods } = await seedCompleted(client, 500);

      await expectReviseRejected(
        client,
        target.sessionId,
        [{ line_item_id: other.lineIds[0], actual_quantity: 5 }],
        /does not belong to session/,
      );

      // The other session's line and finished good are untouched.
      expect(await readActual(client, other.lineIds[0])).toBe("96");
      expect(await readFgQty(client, otherGoods[0].id)).toBe(96);
      expect((await readSession(client, other.sessionId)).status).toBe("completed");
    });
  });

  it.each([
    ["negative", -1],
    ["fractional", 4.5],
  ])("rejects a %s actual_quantity", async (_label, qty) => {
    await inTx(async (client) => {
      const { fx, goods } = await seedCompleted(client, 600);

      await expectReviseRejected(
        client,
        fx.sessionId,
        [{ line_item_id: fx.lineIds[0], actual_quantity: qty }],
        /non-negative whole number/,
      );

      expect(await readFgQty(client, goods[0].id)).toBe(96);
      expect((await readSession(client, fx.sessionId)).status).toBe("completed");
    });
  });

  it("rejects a no-op revision that changes nothing", async () => {
    // Submitting the value the line already has updates zero lines, which the
    // function treats as an empty submission rather than silently flipping the
    // session to `revised`.
    await inTx(async (client) => {
      const { fx } = await seedCompleted(client, 700);

      await expectReviseRejected(
        client,
        fx.sessionId,
        [{ line_item_id: fx.lineIds[0], actual_quantity: 96 }],
        /No quantity changes submitted/,
      );

      expect((await readSession(client, fx.sessionId)).status).toBe("completed");
    });
  });
});

describe("revise_packaging_session — revaluation", () => {
  it("revises a lot down and flips the session to revised", async () => {
    await inTx(async (client) => {
      const { fx, goods } = await seedCompleted(client, 800);
      expect(goods[0].quantity).toBe(96);

      const summary = await revise(client, fx.sessionId, [
        { line_item_id: fx.lineIds[0], actual_quantity: 90 },
      ]);

      expect(summary.lines_updated).toBe(1);
      expect(summary.fg_updated).toBe(1);
      expect(summary.fg_created).toBe(0);

      expect(await readFgQty(client, goods[0].id)).toBe(90);
      expect(await readActual(client, fx.lineIds[0])).toBe("90");
      // The status flip goes through the app.revising_session GUC handshake
      // with packaging_session_before_update(); this is the outage-adjacent bit.
      expect((await readSession(client, fx.sessionId)).status).toBe("revised");
    });
  });

  it("revises a lot up", async () => {
    await inTx(async (client) => {
      const { fx, goods } = await seedCompleted(client, 900);

      const summary = await revise(client, fx.sessionId, [
        { line_item_id: fx.lineIds[0], actual_quantity: 120 },
      ]);

      expect(summary.lines_updated).toBe(1);
      expect(await readFgQty(client, goods[0].id)).toBe(120);
      expect(await readActual(client, fx.lineIds[0])).toBe("120");
      expect((await readSession(client, fx.sessionId)).status).toBe("revised");
    });
  });

  it("changes only the line items named in the payload", async () => {
    await inTx(async (client) => {
      const { fx, goods } = await seedCompleted(client, 1000, [
        { planned: 100, actual: 96 },
        { planned: 64, actual: 60 },
      ]);

      const summary = await revise(client, fx.sessionId, [
        { line_item_id: fx.lineIds[0], actual_quantity: 80 },
      ]);

      expect(summary.lines_updated).toBe(1);
      expect(await readFgQty(client, goods[0].id)).toBe(80);
      // Second line untouched.
      expect(await readFgQty(client, goods[1].id)).toBe(60);
      expect(await readActual(client, fx.lineIds[1])).toBe("60");
    });
  });

  it("revises several line items in one call", async () => {
    await inTx(async (client) => {
      const { fx, goods } = await seedCompleted(client, 1100, [
        { planned: 100, actual: 96 },
        { planned: 64, actual: 60 },
      ]);

      const summary = await revise(client, fx.sessionId, [
        { line_item_id: fx.lineIds[0], actual_quantity: 90 },
        { line_item_id: fx.lineIds[1], actual_quantity: 55 },
      ]);

      expect(summary.lines_updated).toBe(2);
      expect(summary.fg_updated).toBe(2);
      expect(await readFgQty(client, goods[0].id)).toBe(90);
      expect(await readFgQty(client, goods[1].id)).toBe(55);
    });
  });

  it("appends the reason to the session notes as an audit trail", async () => {
    await inTx(async (client) => {
      const { fx } = await seedCompleted(client, 1200);

      await revise(
        client,
        fx.sessionId,
        [{ line_item_id: fx.lineIds[0], actual_quantity: 90 }],
        "Miscounted the pallet",
      );

      const { notes } = await readSession(client, fx.sessionId);
      expect(notes).toContain("Miscounted the pallet");
      expect(notes).toMatch(/Revised \d{4}-\d{2}-\d{2}:/);
    });
  });

  it("leaves notes untouched when no reason is given", async () => {
    await inTx(async (client) => {
      const { fx } = await seedCompleted(client, 1300);

      await revise(client, fx.sessionId, [
        { line_item_id: fx.lineIds[0], actual_quantity: 90 },
      ]);

      expect((await readSession(client, fx.sessionId)).notes).toBeNull();
    });
  });

  it("allows an already-revised session to be revised again", async () => {
    // The status check admits both 'completed' and 'revised'; a second
    // correction to the same session must not be locked out.
    await inTx(async (client) => {
      const { fx, goods } = await seedCompleted(client, 1400);

      await revise(client, fx.sessionId, [
        { line_item_id: fx.lineIds[0], actual_quantity: 90 },
      ]);
      expect((await readSession(client, fx.sessionId)).status).toBe("revised");

      const second = await revise(
        client,
        fx.sessionId,
        [{ line_item_id: fx.lineIds[0], actual_quantity: 85 }],
        "Recount",
      );

      expect(second.lines_updated).toBe(1);
      expect(await readFgQty(client, goods[0].id)).toBe(85);
      expect((await readSession(client, fx.sessionId)).status).toBe("revised");
    });
  });

  it("revises a lot to zero", async () => {
    // The boundary of the reduction path: 0 is a legal actual_quantity, and
    // must not be confused with the NULL "no value submitted" case.
    await inTx(async (client) => {
      const { fx, goods } = await seedCompleted(client, 1500);

      const summary = await revise(client, fx.sessionId, [
        { line_item_id: fx.lineIds[0], actual_quantity: 0 },
      ]);

      expect(summary.lines_updated).toBe(1);
      expect(await readFgQty(client, goods[0].id)).toBe(0);
      expect(await readActual(client, fx.lineIds[0])).toBe("0");
    });
  });
});
