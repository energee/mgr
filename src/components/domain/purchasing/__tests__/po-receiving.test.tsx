// @vitest-environment jsdom
/**
 * Tests for POReceiving's write path.
 *
 * The fulfilled/partial rule no longer lives in TypeScript. It — along with the over-receipt
 * check and the state-machine transition validation — now lives inside the
 * `receive_purchase_order_items` Postgres function
 * (supabase/migrations/00245_receive_purchase_order_items.sql), so the whole receipt commits
 * or aborts as one transaction. That closed the last defect from #412: the receives used to be
 * inserted before the status was read and validated, so receiving against a `draft` PO
 * recorded the receipt and then threw, leaving the rows behind with no rollback.
 *
 * What remains testable from the client is therefore the BOUNDARY, and that is what these
 * tests cover: the entries the component hands to the function, and what it does with the
 * result. The rule's own cases (empty line list, null/zero ordered quantity, over-receipt,
 * completeness) are assertions about SQL and are verified against the database, not here —
 * this file no longer pretends to cover them.
 *
 * Idiom: react-query is mocked so the mutationFn can be captured and invoked directly (the
 * write path is otherwise only reachable through deep dialog UI). The Supabase client is
 * mocked at the module boundary because `@/lib/supabase/client` runs env validation at import
 * time.
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
const RPC = "receive_purchase_order_items";

function entry(overrides: Partial<Entry> & { po_line_item_id: string; quantity: number }): Entry {
  return {
    lot_number: "",
    expiration_date: "",
    notes: "",
    ...overrides,
  };
}

/** Mounts the component (registering its mutationFn) against a fake Supabase. */
function setup(rpcResponses: Record<string, QueuedResponse[]>) {
  const sb = makeSupabase({}, rpcResponses);
  fixture.supabase = sb.supabase;
  fixture.mutationFn = null;
  render(<POReceiving poId={PO_ID} open onOpenChange={() => {}} />);
  const run = fixture.mutationFn;
  if (!run) throw new Error("mutationFn was not registered");
  return { ...sb, run: run as (entries: Entry[]) => Promise<unknown> };
}

/** The function returns the status the order ended up in. */
const returns = (status: string): Record<string, QueuedResponse[]> => ({
  [RPC]: [{ data: status, error: null }],
});

beforeEach(() => {
  fixture.mutationFn = null;
});

describe("POReceiving — the receipt is one atomic call", () => {
  it("hands the whole receipt to the database in a single call", async () => {
    const sb = setup(returns("fulfilled"));

    await sb.run([
      entry({ po_line_item_id: "li-1", quantity: 10 }),
      entry({ po_line_item_id: "li-2", quantity: 5 }),
    ]);

    // One call — not insert-then-read-then-update. There is no window in which the receives
    // exist but the status has not been decided.
    expect(sb.rpcSpy).toHaveBeenCalledTimes(1);
    expect(sb.fromSpy).not.toHaveBeenCalled();
    expect(sb.rpcSpy).toHaveBeenCalledWith(RPC, {
      p_po_id: PO_ID,
      p_entries: [
        {
          po_line_item_id: "li-1",
          quantity: 10,
          lot_number: null,
          expiration_date: null,
          notes: null,
        },
        {
          po_line_item_id: "li-2",
          quantity: 5,
          lot_number: null,
          expiration_date: null,
          notes: null,
        },
      ],
    });
  });

  it("returns the status the order ended up in", async () => {
    const sb = setup(returns("partial"));
    await expect(sb.run([entry({ po_line_item_id: "li-1", quantity: 1 })])).resolves.toBe(
      "partial",
    );
  });

  it("passes lot number, expiration and notes through, nulling empty strings", async () => {
    const sb = setup(returns("partial"));

    await sb.run([
      entry({
        po_line_item_id: "li-1",
        quantity: 4,
        lot_number: "LOT-1",
        expiration_date: "2026-01-01",
        notes: "dented",
      }),
    ]);

    expect(sb.rpcSpy.mock.calls[0][1]).toEqual({
      p_po_id: PO_ID,
      p_entries: [
        {
          po_line_item_id: "li-1",
          quantity: 4,
          lot_number: "LOT-1",
          expiration_date: "2026-01-01",
          notes: "dented",
        },
      ],
    });
  });

  it("propagates a rejection from the database without touching any table", async () => {
    // e.g. an illegal transition, or an over-receipt. Previously the receives were already
    // inserted by the time this threw; now the whole transaction aborts.
    const message =
      'Cannot transition from "draft" to "partial". Valid transitions: submitted, cancelled';
    const sb = setup({ [RPC]: [{ data: null, error: { message } }] });

    await expect(sb.run([entry({ po_line_item_id: "li-1", quantity: 1 })])).rejects.toEqual({
      message,
    });
    expect(sb.fromSpy).not.toHaveBeenCalled();
  });
});
