// @vitest-environment jsdom
/**
 * Characterization tests for POReceiving's write path.
 *
 * The fulfilled/partial business rule lives inside the component's
 * `useMutation({ mutationFn })` (po-receiving.tsx ~L192-287). These tests pin
 * CURRENT behavior — including bugs — ahead of extracting the rule into
 * src/domain/purchasing/ + a service. They do NOT assert what the rule *should*
 * be; a behavior-preserving extraction must keep every case below green.
 *
 * Idiom: react-query is mocked so the mutationFn can be captured and invoked
 * directly (the rule is otherwise only reachable through deep dialog UI). The
 * Supabase client is mocked at the module boundary because
 * `@/lib/supabase/client` runs env validation at import time.
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
 * Mounts the component (which registers its mutationFn) against a fake Supabase
 * whose per-table queues are consumed in the mutationFn's call order:
 *   po_receives:     [insert, select-all]
 *   purchase_orders: [select status, update status]
 *   po_line_items:   [select id/quantity]
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

/** Standard happy-path queues; caller supplies line items + existing receives. */
function queues(opts: {
  status: string;
  items: Array<{ id: string; quantity: number | null }>;
  receives: Array<{ po_line_item_id: string; quantity: number }>;
  updateResponse?: QueuedResponse;
}): Record<string, QueuedResponse[]> {
  return {
    po_receives: [ok, { data: opts.receives, error: null }],
    purchase_orders: [
      { data: { status: opts.status }, error: null },
      opts.updateResponse ?? ok,
    ],
    po_line_items: [{ data: opts.items, error: null }],
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

  it("treats over-receipt (received > ordered) as fulfilled — no cap, no error", async () => {
    const { callsByTable, run } = setup(
      queues({
        status: "confirmed",
        items: [{ id: "li-1", quantity: 10 }],
        receives: [{ po_line_item_id: "li-1", quantity: 999 }],
      }),
    );

    await run([entry({ po_line_item_id: "li-1", quantity: 999 })]);

    expect(callsByTable.purchase_orders[1].update).toHaveBeenCalledWith({
      status: "fulfilled",
    });
  });

  it("QUIRK: float summation error makes an exactly-complete receive land as partial", async () => {
    // 0.7 + 0.1 === 0.7999999999999999 < 0.8 in IEEE-754. The rule compares with
    // a bare `>=` and has NO epsilon tolerance, so a line ordered at 0.8 that was
    // physically fully received (0.7 then 0.1) keeps the PO at "partial" forever.
    expect(0.7 + 0.1).toBeLessThan(0.8);

    const { callsByTable, run } = setup(
      queues({
        status: "confirmed",
        items: [{ id: "li-1", quantity: 0.8 }],
        receives: [
          { po_line_item_id: "li-1", quantity: 0.7 },
          { po_line_item_id: "li-1", quantity: 0.1 },
        ],
      }),
    );

    await run([entry({ po_line_item_id: "li-1", quantity: 0.1 })]);

    expect(callsByTable.purchase_orders[1].update).toHaveBeenCalledWith({
      status: "partial",
    });
  });

  it("QUIRK: a line with NULL ordered quantity counts as fully received (0 >= null)", async () => {
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
      status: "fulfilled",
    });
  });

  it("QUIRK: a PO whose line-item re-query returns [] flips straight to fulfilled", async () => {
    // Array.prototype.every([]) === true, so zero line items => allFullyReceived.
    const { callsByTable, run } = setup(
      queues({
        status: "confirmed",
        items: [],
        receives: [],
      }),
    );

    await run([entry({ po_line_item_id: "li-ghost", quantity: 5 })]);

    expect(callsByTable.purchase_orders[1].update).toHaveBeenCalledWith({
      status: "fulfilled",
    });
  });

  it("QUIRK: a line with ZERO ordered quantity is 'fully received' with nothing received", async () => {
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
      status: "fulfilled",
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
    expect(callsByTable.po_line_items[0].eq).toHaveBeenCalledWith("po_id", PO_ID);
    expect(callsByTable.po_receives[1].in).toHaveBeenCalledWith(
      "po_line_item_id",
      ["li-1"],
    );
  });
});

describe("POReceiving — state-machine transition validation", () => {
  it("no-ops (no status write) when already in the target state", async () => {
    // partial -> partial is not a legal transition, but the code short-circuits.
    const sb = setup({
      po_receives: [ok, { data: [{ po_line_item_id: "li-1", quantity: 1 }], error: null }],
      purchase_orders: [{ data: { status: "partial" }, error: null }],
      po_line_items: [{ data: [{ id: "li-1", quantity: 10 }], error: null }],
    });

    await sb.run([entry({ po_line_item_id: "li-1", quantity: 1 })]);

    // only ONE purchase_orders call (the status select) — no update
    expect(sb.callsByTable.purchase_orders).toHaveLength(1);
  });

  it("throws when the current status cannot transition to the target (draft -> partial)", async () => {
    const sb = setup({
      po_receives: [ok, { data: [{ po_line_item_id: "li-1", quantity: 1 }], error: null }],
      purchase_orders: [{ data: { status: "draft" }, error: null }],
      po_line_items: [{ data: [{ id: "li-1", quantity: 10 }], error: null }],
    });

    await expect(
      sb.run([entry({ po_line_item_id: "li-1", quantity: 1 })]),
    ).rejects.toThrow(
      'Cannot transition from "draft" to "partial". Valid transitions: submitted, cancelled',
    );
    // BUG: the po_receives rows were ALREADY inserted before this throw.
    expect(sb.callsByTable.po_receives[0].insert).toHaveBeenCalled();
  });

  it("throws when receiving against a cancelled PO", async () => {
    const sb = setup({
      po_receives: [ok, { data: [{ po_line_item_id: "li-1", quantity: 10 }], error: null }],
      purchase_orders: [{ data: { status: "cancelled" }, error: null }],
      po_line_items: [{ data: [{ id: "li-1", quantity: 10 }], error: null }],
    });

    await expect(
      sb.run([entry({ po_line_item_id: "li-1", quantity: 10 })]),
    ).rejects.toThrow('Cannot transition from "cancelled" to "fulfilled". Valid transitions: none');
  });

  it("throws when an already-fulfilled PO goes back to partial (line added post-fulfilment)", async () => {
    const sb = setup({
      po_receives: [ok, { data: [{ po_line_item_id: "li-1", quantity: 10 }], error: null }],
      purchase_orders: [{ data: { status: "fulfilled" }, error: null }],
      po_line_items: [
        { data: [{ id: "li-1", quantity: 10 }, { id: "li-2", quantity: 5 }], error: null },
      ],
    });

    await expect(
      sb.run([entry({ po_line_item_id: "li-1", quantity: 10 })]),
    ).rejects.toThrow('Cannot transition from "fulfilled" to "partial"');
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

    expect(sb.callsByTable.po_receives[0].insert).toHaveBeenCalledWith([
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

    const inserted = sb.callsByTable.po_receives[0].insert.mock
      .calls[0][0] as Array<{ po_line_item_id: string }>;
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

    expect(sb.callsByTable.po_receives[0].insert).toHaveBeenCalledWith([
      expect.objectContaining({ quantity: 0.30000000000000004 }),
    ]);
  });
});

describe("POReceiving — side-effect ordering and partial failure", () => {
  it("inserts receives BEFORE reading status / recomputing totals / updating status", async () => {
    const sb = setup(
      queues({
        status: "confirmed",
        items: [{ id: "li-1", quantity: 10 }],
        receives: [{ po_line_item_id: "li-1", quantity: 10 }],
      }),
    );

    await sb.run([entry({ po_line_item_id: "li-1", quantity: 10 })]);

    expect(sb.fromSpy.mock.calls.map((c) => c[0])).toEqual([
      "po_receives", // insert
      "purchase_orders", // read current status
      "po_line_items", // re-query ordered quantities
      "po_receives", // re-query all receives
      "purchase_orders", // write new status
    ]);
  });

  it("BUG (not fixed): a failing status update leaves the inserted receives behind — no rollback", async () => {
    const sb = setup(
      queues({
        status: "confirmed",
        items: [{ id: "li-1", quantity: 10 }],
        receives: [{ po_line_item_id: "li-1", quantity: 10 }],
        updateResponse: { data: null, error: { message: "status write failed" } },
      }),
    );

    await expect(
      sb.run([entry({ po_line_item_id: "li-1", quantity: 10 })]),
    ).rejects.toEqual({ message: "status write failed" });

    expect(sb.callsByTable.po_receives[0].insert).toHaveBeenCalled();
  });

  it("aborts before any status work when the receives insert itself fails", async () => {
    const sb = setup({
      po_receives: [{ data: null, error: { message: "insert failed" } }],
    });

    await expect(
      sb.run([entry({ po_line_item_id: "li-1", quantity: 1 })]),
    ).rejects.toEqual({ message: "insert failed" });
    expect(sb.fromSpy.mock.calls.map((c) => c[0])).toEqual(["po_receives"]);
  });

  it("propagates a failed current-status fetch after the receives are already written", async () => {
    const sb = setup({
      po_receives: [ok],
      purchase_orders: [{ data: null, error: { message: "po missing" } }],
    });

    await expect(
      sb.run([entry({ po_line_item_id: "li-1", quantity: 1 })]),
    ).rejects.toEqual({ message: "po missing" });
    expect(sb.callsByTable.po_receives[0].insert).toHaveBeenCalled();
  });
});
