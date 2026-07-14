// @vitest-environment jsdom
/**
 * Tests for POReceiving's write path (now delegated to receivePurchaseOrderItems).
 *
 * These began as characterization tests pinning the rule while it still lived inside the
 * component's `useMutation`, quirks included. The quirk cases have since been flipped to
 * assert correct behavior as each defect was fixed: an empty line list or a null/zero
 * ordered quantity no longer closes the order, float drift no longer strands a line short
 * of complete, and an over-receipt is now rejected before any row is written.
 *
 * The one defect still open is the lack of atomicity — the receives are inserted before the
 * status is read and validated, and a later throw does not roll them back. The tests at the
 * bottom pin that residual behavior so the eventual RPC fix has something to flip.
 *
 * Idiom: react-query is mocked so the mutationFn can be captured and invoked directly (the
 * rule is otherwise only reachable through deep dialog UI). The Supabase client is mocked at
 * the module boundary because `@/lib/supabase/client` runs env validation at import time.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupRenderHarness } from "@/test/react-harness";
import { makeSupabase, type QueuedResponse } from "@/test/supabase-mock";

type Entry = {
  po_line_item_id: string;
  quantity: number;
  lot_number: string;
  expiration_date: string;
  notes: string;
};

const fixture = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: null as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mutationFn: null as null | ((entries: Entry[]) => Promise<any>),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => fixture.supabase,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [], isLoading: false }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useMutation: (opts: any) => {
    fixture.mutationFn = opts.mutationFn;
    return { mutate: vi.fn(), isPending: false };
  },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/client-logger", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { POReceiving } from "../po-receiving";

const { render } = setupRenderHarness();

const PO_ID = "po-1";

function entry(overrides: Partial<Entry> & { po_line_item_id: string; quantity: number }): Entry {
  return {
    lot_number: "",
    expiration_date: "",
    notes: "",
    ...overrides,
  };
}

/**
 * Mounts the component (which registers its mutationFn) against a fake Supabase whose
 * per-table queues are consumed in the write path's call order:
 *   po_line_items:   [select ordered (over-receipt check), select ordered (recompute)]
 *   po_receives:     [select prior (over-receipt check), insert, select all (recompute)]
 *   purchase_orders: [select status, update status]
 */
function setup(responses: Record<string, QueuedResponse[]>) {
  const sb = makeSupabase(responses);
  fixture.supabase = sb.supabase;
  fixture.mutationFn = null;
  render(<POReceiving poId={PO_ID} open onOpenChange={() => {}} />);
  const run = fixture.mutationFn;
  if (!run) throw new Error("mutationFn was not registered");
  return { ...sb, run: run as (entries: Entry[]) => Promise<unknown> };
}

const ok = { data: null, error: null };

/**
 * Standard happy-path queues.
 *
 * `items` are the order's line items (read twice); `prior` is what had already been received
 * BEFORE this submission (defaults to nothing) and drives the over-receipt check; `receives`
 * is what the database reports AFTER the insert and drives the status decision.
 */
function queues(opts: {
  status: string;
  items: Array<{ id: string; quantity: number | null }>;
  receives: Array<{ po_line_item_id: string; quantity: number }>;
  prior?: Array<{ po_line_item_id: string; quantity: number }>;
  updateResponse?: QueuedResponse;
}): Record<string, QueuedResponse[]> {
  return {
    po_line_items: [
      { data: opts.items, error: null },
      { data: opts.items, error: null },
    ],
    po_receives: [
      { data: opts.prior ?? [], error: null },
      ok,
      { data: opts.receives, error: null },
    ],
    purchase_orders: [{ data: { status: opts.status }, error: null }, opts.updateResponse ?? ok],
  };
}

beforeEach(() => {
  fixture.mutationFn = null;
});

describe("POReceiving — status decision (fulfilled vs partial)", () => {
  it("marks fulfilled when every line's total received >= ordered", async () => {
    const { callsByTable, run } = setup(
      queues({
        status: "confirmed",
        items: [
          { id: "li-1", quantity: 10 },
          { id: "li-2", quantity: 5 },
        ],
        prior: [{ po_line_item_id: "li-2", quantity: 5 }],
        receives: [
          { po_line_item_id: "li-1", quantity: 10 },
          { po_line_item_id: "li-2", quantity: 5 },
        ],
      }),
    );

    await run([entry({ po_line_item_id: "li-1", quantity: 10 })]);

    expect(callsByTable.purchase_orders[1].update).toHaveBeenCalledWith({
      status: "fulfilled",
    });
  });

  it("marks partial when any line is short by any amount", async () => {
    const { callsByTable, run } = setup(
      queues({
        status: "confirmed",
        items: [
          { id: "li-1", quantity: 10 },
          { id: "li-2", quantity: 5 },
        ],
        receives: [
          { po_line_item_id: "li-1", quantity: 10 },
          { po_line_item_id: "li-2", quantity: 4.99 },
        ],
      }),
    );

    await run([entry({ po_line_item_id: "li-1", quantity: 10 })]);

    expect(callsByTable.purchase_orders[1].update).toHaveBeenCalledWith({
      status: "partial",
    });
  });

  it("sums MULTIPLE receive rows per line item when comparing to ordered", async () => {
    const { callsByTable, run } = setup(
      queues({
        status: "partial",
        items: [{ id: "li-1", quantity: 10 }],
        prior: [{ po_line_item_id: "li-1", quantity: 6 }],
        receives: [
          { po_line_item_id: "li-1", quantity: 6 },
          { po_line_item_id: "li-1", quantity: 4 },
        ],
      }),
    );

    await run([entry({ po_line_item_id: "li-1", quantity: 4 })]);

    expect(callsByTable.purchase_orders[1].update).toHaveBeenCalledWith({
      status: "fulfilled",
    });
  });

  it("float drift no longer strands an exactly-complete receive at partial", async () => {
    // 0.7 + 0.1 === 0.7999999999999999 < 0.8 in IEEE-754. Compared with a bare `>=` this
    // kept a physically-complete line at "partial" forever; RECEIPT_EPSILON absorbs it.
    expect(0.7 + 0.1).toBeLessThan(0.8);

    const { callsByTable, run } = setup(
      queues({
        status: "confirmed",
        items: [{ id: "li-1", quantity: 0.8 }],
        prior: [{ po_line_item_id: "li-1", quantity: 0.7 }],
        receives: [
          { po_line_item_id: "li-1", quantity: 0.7 },
          { po_line_item_id: "li-1", quantity: 0.1 },
        ],
      }),
    );

    await run([entry({ po_line_item_id: "li-1", quantity: 0.1 })]);

    expect(callsByTable.purchase_orders[1].update).toHaveBeenCalledWith({
      status: "fulfilled",
    });
  });

  it("a line with NULL ordered quantity no longer counts as fully received", async () => {
    const { callsByTable, run } = setup(
      queues({
        status: "confirmed",
        items: [
          { id: "li-1", quantity: 10 },
          { id: "li-null", quantity: null },
        ],
        receives: [{ po_line_item_id: "li-1", quantity: 10 }],
      }),
    );

    await run([entry({ po_line_item_id: "li-1", quantity: 10 })]);

    expect(callsByTable.purchase_orders[1].update).toHaveBeenCalledWith({
      status: "partial",
    });
  });

  it("a line with ZERO ordered quantity no longer counts as fully received", async () => {
    const { callsByTable, run } = setup(
      queues({
        status: "confirmed",
        items: [
          { id: "li-1", quantity: 10 },
          { id: "li-zero", quantity: 0 },
        ],
        receives: [{ po_line_item_id: "li-1", quantity: 10 }],
      }),
    );

    await run([entry({ po_line_item_id: "li-1", quantity: 10 })]);

    expect(callsByTable.purchase_orders[1].update).toHaveBeenCalledWith({
      status: "partial",
    });
  });

  it("recomputes totals from the DB (not from the submitted entries)", async () => {
    // Submitted entry claims 1 unit, but the DB re-query says the line is full.
    // The rule trusts the DB re-query.
    const { callsByTable, run } = setup(
      queues({
        status: "partial",
        items: [{ id: "li-1", quantity: 10 }],
        receives: [{ po_line_item_id: "li-1", quantity: 10 }],
      }),
    );

    await run([entry({ po_line_item_id: "li-1", quantity: 1 })]);

    expect(callsByTable.purchase_orders[1].update).toHaveBeenCalledWith({
      status: "fulfilled",
    });
    // the re-query is filtered by po_id, and receives by the re-queried line ids
    expect(callsByTable.po_line_items[1].eq).toHaveBeenCalledWith("po_id", PO_ID);
    expect(callsByTable.po_receives[2].in).toHaveBeenCalledWith("po_line_item_id", ["li-1"]);
  });
});

describe("POReceiving — over-receipt rejection", () => {
  it("rejects a receipt beyond the ordered quantity, writing nothing", async () => {
    const sb = setup(
      queues({
        status: "confirmed",
        items: [{ id: "li-1", quantity: 10 }],
        receives: [],
      }),
    );

    await expect(sb.run([entry({ po_line_item_id: "li-1", quantity: 999 })])).rejects.toThrow(
      /Cannot receive more than was ordered.*ordered 10.*submitted 999/,
    );
    expect(sb.callsByTable.po_receives[0].insert).not.toHaveBeenCalled();
  });

  it("counts already-received quantity, so a second receipt cannot overshoot", async () => {
    const sb = setup(
      queues({
        status: "partial",
        items: [{ id: "li-1", quantity: 10 }],
        prior: [{ po_line_item_id: "li-1", quantity: 8 }],
        receives: [],
      }),
    );

    await expect(sb.run([entry({ po_line_item_id: "li-1", quantity: 3 })])).rejects.toThrow(
      /already received 8/,
    );
  });

  it("rejects a receipt against a line item that is not on the order", async () => {
    // Previously an order whose line-item query returned [] flipped straight to "fulfilled".
    const sb = setup(queues({ status: "confirmed", items: [], receives: [] }));

    await expect(sb.run([entry({ po_line_item_id: "li-ghost", quantity: 5 })])).rejects.toThrow(
      /Cannot receive more than was ordered/,
    );
    expect(sb.callsByTable.po_receives[0].insert).not.toHaveBeenCalled();
  });
});

describe("POReceiving — state-machine transition validation", () => {
  it("no-ops (no status write) when already in the target state", async () => {
    // partial -> partial is not a legal transition, but the code short-circuits.
    const sb = setup(
      queues({
        status: "partial",
        items: [{ id: "li-1", quantity: 10 }],
        receives: [{ po_line_item_id: "li-1", quantity: 1 }],
      }),
    );

    await sb.run([entry({ po_line_item_id: "li-1", quantity: 1 })]);

    // only ONE purchase_orders call (the status select) — no update
    expect(sb.callsByTable.purchase_orders).toHaveLength(1);
  });

  it("throws when the current status cannot transition to the target (draft -> partial)", async () => {
    const sb = setup(
      queues({
        status: "draft",
        items: [{ id: "li-1", quantity: 10 }],
        receives: [{ po_line_item_id: "li-1", quantity: 1 }],
      }),
    );

    await expect(sb.run([entry({ po_line_item_id: "li-1", quantity: 1 })])).rejects.toThrow(
      'Cannot transition from "draft" to "partial". Valid transitions: submitted, cancelled',
    );
    // STILL A BUG: the po_receives rows were already inserted before this throw. Closing this
    // needs the whole sequence inside a Postgres function.
    expect(sb.callsByTable.po_receives[1].insert).toHaveBeenCalled();
  });

  it("throws when receiving against a cancelled PO", async () => {
    const sb = setup(
      queues({
        status: "cancelled",
        items: [{ id: "li-1", quantity: 10 }],
        receives: [{ po_line_item_id: "li-1", quantity: 10 }],
      }),
    );

    await expect(sb.run([entry({ po_line_item_id: "li-1", quantity: 10 })])).rejects.toThrow(
      'Cannot transition from "cancelled" to "fulfilled". Valid transitions: none',
    );
  });

  it("throws when an already-fulfilled PO goes back to partial (line added post-fulfilment)", async () => {
    const sb = setup(
      queues({
        status: "fulfilled",
        items: [
          { id: "li-1", quantity: 10 },
          { id: "li-2", quantity: 5 },
        ],
        receives: [{ po_line_item_id: "li-1", quantity: 10 }],
      }),
    );

    await expect(sb.run([entry({ po_line_item_id: "li-1", quantity: 10 })])).rejects.toThrow(
      'Cannot transition from "fulfilled" to "partial"',
    );
  });

  it("allows confirmed -> fulfilled and partial -> fulfilled", async () => {
    for (const status of ["confirmed", "partial"]) {
      const sb = setup(
        queues({
          status,
          items: [{ id: "li-1", quantity: 10 }],
          receives: [{ po_line_item_id: "li-1", quantity: 10 }],
        }),
      );
      await sb.run([entry({ po_line_item_id: "li-1", quantity: 10 })]);
      expect(sb.callsByTable.purchase_orders[1].update).toHaveBeenCalledWith({
        status: "fulfilled",
      });
      expect(sb.callsByTable.purchase_orders[1].eq).toHaveBeenCalledWith("id", PO_ID);
    }
  });
});

describe("POReceiving — insert payload and entry filtering", () => {
  it("inserts only positive-quantity entries, nulling empty lot/expiration/notes", async () => {
    const sb = setup(
      queues({
        status: "confirmed",
        items: [{ id: "li-1", quantity: 10 }],
        receives: [{ po_line_item_id: "li-1", quantity: 4 }],
      }),
    );

    await sb.run([
      entry({
        po_line_item_id: "li-1",
        quantity: 4,
        lot_number: "LOT-1",
        expiration_date: "2026-01-01",
      }),
      entry({ po_line_item_id: "li-2", quantity: 0, lot_number: "LOT-SKIP" }),
      entry({ po_line_item_id: "li-3", quantity: -5, lot_number: "LOT-NEG" }),
    ]);

    expect(sb.callsByTable.po_receives[1].insert).toHaveBeenCalledWith([
      {
        po_line_item_id: "li-1",
        quantity: 4,
        lot_number: "LOT-1",
        expiration_date: "2026-01-01",
        notes: null,
      },
    ]);
  });

  it("QUIRK: negative quantities are silently dropped, not rejected", async () => {
    const sb = setup(
      queues({
        status: "confirmed",
        items: [{ id: "li-1", quantity: 10 }],
        receives: [{ po_line_item_id: "li-1", quantity: 10 }],
      }),
    );

    await sb.run([
      entry({ po_line_item_id: "li-1", quantity: 10 }),
      entry({ po_line_item_id: "li-2", quantity: -3 }),
    ]);

    const inserted = sb.callsByTable.po_receives[1].insert.mock.calls[0][0] as Array<{
      po_line_item_id: string;
    }>;
    expect(inserted.map((r) => r.po_line_item_id)).toEqual(["li-1"]);
  });

  it("throws 'No quantities to receive' when every entry is zero/negative — no DB call at all", async () => {
    const sb = setup({});

    await expect(
      sb.run([
        entry({ po_line_item_id: "li-1", quantity: 0 }),
        entry({ po_line_item_id: "li-2", quantity: -1 }),
      ]),
    ).rejects.toThrow("No quantities to receive");
    expect(sb.fromSpy).not.toHaveBeenCalled();
  });

  it("throws 'No quantities to receive' for an empty entry list", async () => {
    const sb = setup({});
    await expect(sb.run([])).rejects.toThrow("No quantities to receive");
    expect(sb.fromSpy).not.toHaveBeenCalled();
  });

  it("persists fractional (float) quantities verbatim", async () => {
    const sb = setup(
      queues({
        status: "confirmed",
        items: [{ id: "li-1", quantity: 10 }],
        receives: [{ po_line_item_id: "li-1", quantity: 0.30000000000000004 }],
      }),
    );

    await sb.run([entry({ po_line_item_id: "li-1", quantity: 0.1 + 0.2 })]);

    expect(sb.callsByTable.po_receives[1].insert).toHaveBeenCalledWith([
      expect.objectContaining({ quantity: 0.30000000000000004 }),
    ]);
  });
});

describe("POReceiving — side-effect ordering and partial failure", () => {
  it("validates the over-receipt BEFORE inserting, then reads and updates status", async () => {
    const sb = setup(
      queues({
        status: "confirmed",
        items: [{ id: "li-1", quantity: 10 }],
        receives: [{ po_line_item_id: "li-1", quantity: 10 }],
      }),
    );

    await sb.run([entry({ po_line_item_id: "li-1", quantity: 10 })]);

    expect(sb.fromSpy.mock.calls.map((c) => c[0])).toEqual([
      "po_line_items", // read ordered quantities (over-receipt check)
      "po_receives", // read prior receipts (over-receipt check)
      "po_receives", // insert
      "purchase_orders", // read current status
      "po_line_items", // re-query ordered quantities
      "po_receives", // re-query all receives
      "purchase_orders", // write new status
    ]);
  });

  it("BUG (still open): a failing status update leaves the inserted receives behind — no rollback", async () => {
    // The over-receipt check narrows the window but does not close it: once the insert lands,
    // any later failure strands the rows. Fixing this needs a Postgres function.
    const sb = setup(
      queues({
        status: "confirmed",
        items: [{ id: "li-1", quantity: 10 }],
        receives: [{ po_line_item_id: "li-1", quantity: 10 }],
        updateResponse: { data: null, error: { message: "status write failed" } },
      }),
    );

    await expect(sb.run([entry({ po_line_item_id: "li-1", quantity: 10 })])).rejects.toEqual({
      message: "status write failed",
    });

    expect(sb.callsByTable.po_receives[1].insert).toHaveBeenCalled();
  });

  it("aborts before any status work when the receives insert itself fails", async () => {
    const sb = setup({
      po_line_items: [{ data: [{ id: "li-1", quantity: 10 }], error: null }],
      po_receives: [
        { data: [], error: null },
        { data: null, error: { message: "insert failed" } },
      ],
    });

    await expect(sb.run([entry({ po_line_item_id: "li-1", quantity: 1 })])).rejects.toEqual({
      message: "insert failed",
    });
    expect(sb.fromSpy.mock.calls.map((c) => c[0])).toEqual([
      "po_line_items",
      "po_receives",
      "po_receives",
    ]);
  });

  it("propagates a failed current-status fetch after the receives are already written", async () => {
    const sb = setup({
      po_line_items: [{ data: [{ id: "li-1", quantity: 10 }], error: null }],
      po_receives: [{ data: [], error: null }, ok],
      purchase_orders: [{ data: null, error: { message: "po missing" } }],
    });

    await expect(sb.run([entry({ po_line_item_id: "li-1", quantity: 1 })])).rejects.toEqual({
      message: "po missing",
    });
    expect(sb.callsByTable.po_receives[1].insert).toHaveBeenCalled();
  });
});
