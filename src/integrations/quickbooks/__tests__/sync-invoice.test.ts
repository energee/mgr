/**
 * QuickBooks syncInvoice tests — characterization of the happy paths (create /
 * update / genuinely-empty order) plus the swallowed-read guards from the
 * 2026-07-10 silent-failure audit:
 *
 *   SF-2  a failed qbo_sync_mappings read must ABORT the sync (recorded as a
 *         failed sync-log row), never fall through to "create" — falling
 *         through posts a duplicate Invoice into QuickBooks.
 *   SF-9  a failed order_items read must surface as a read failure, not the
 *         misleading "has no line items" error.
 *   SF-11 a failed customer payment-terms read still falls back to the
 *         default terms, but logs a warning naming the failed read.
 *
 * Durable-create coverage also proves mapping/log write failures surface,
 * the pending intent precedes the external create, and retry uses one stable
 * QuickBooks request identity after mapping failure or a lost response.
 *
 * Mock idiom mirrors sync-bill.test.ts: shared admin mock for Supabase,
 * module mocks for the QBO HTTP client and syncCustomer. Assertions are on
 * posted payloads and rows written to qbo_sync_mappings / qbo_sync_log.
 *
 * NOTE on DueDate strings: addDays (sync-utils) does pure UTC calendar
 * arithmetic, so expectations are plain date math ("2026-03-01" + 14 →
 * "2026-03-15") and hold in any host timezone.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeAdminMock, type TableData, type Write } from "@/test/supabase-admin-mock";

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/integrations/quickbooks/client", () => ({
  qboClient: { get: vi.fn(), post: vi.fn(), query: vi.fn() },
}));

vi.mock("@/integrations/quickbooks/sync-customer", () => ({
  syncCustomer: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { qboClient } from "@/integrations/quickbooks/client";
import { syncInvoice } from "@/integrations/quickbooks/sync-invoice";
import type { QBOInvoice } from "@/integrations/quickbooks/types";

const mockedCreateAdminClient = vi.mocked(createAdminClient);
const mockedPost = vi.mocked(qboClient.post);
const mockedGet = vi.mocked(qboClient.get);

const ORDER_ID = "ord-1";
const CUSTOMER_ID = "cust-1";

const baseOrder = {
  id: ORDER_ID,
  order_number: "SO-100",
  customer_id: CUSTOMER_ID,
  order_date: "2026-03-01",
  fulfilled_date: null,
};

const customerMapping = {
  id: "map-cust",
  entity_type: "customer",
  entity_id: CUSTOMER_ID,
  qbo_entity_type: "Customer",
  qbo_entity_id: "C-55",
  last_synced_at: "2026-01-01T00:00:00Z",
};

const orderMapping = {
  id: "map-ord",
  entity_type: "order",
  entity_id: ORDER_ID,
  qbo_entity_type: "Invoice",
  qbo_entity_id: "I-42",
  last_synced_at: "2026-01-01T00:00:00Z",
};

type ErrorLike = { message: string };

/**
 * qbo_sync_mappings responder — customer precondition vs the order
 * create-vs-update decision, distinguished by the eq("entity_type", ...)
 * filter; upsertMapping's write resolves empty.
 */
function mappingsTable(
  opts: {
    existing?: typeof orderMapping | null;
    readError?: ErrorLike;
    writeErrors?: Array<ErrorLike | null>;
  } = {}
) {
  return ({ calls, ops }: { calls: { method: string; args: unknown[] }[]; ops: string[] }) => {
    if (ops.length) return { data: null, error: opts.writeErrors?.shift() ?? null };
    const entityType = calls.find((c) => c.method === "eq" && c.args[0] === "entity_type")?.args[1];
    if (entityType === "customer") return { data: customerMapping, error: null };
    if (entityType === "order") {
      if (opts.readError) return { data: null, error: opts.readError };
      return { data: opts.existing ?? null, error: null };
    }
    return { data: null, error: null };
  };
}

function makeTables(overrides: TableData = {}): TableData {
  return {
    orders: { data: baseOrder, error: null },
    qbo_sync_mappings: mappingsTable(),
    customers: { data: { payment_terms_days: 14, is_tax_exempt: false }, error: null },
    order_items: {
      data: [
        { quantity: 3, unit_price: "120", brand: { name: "Lager" }, selling_format: { name: "1/2 BBL Keg" } },
        { quantity: 24, unit_price: "2.5", brand: { name: "IPA" }, selling_format: null },
      ],
      error: null,
    },
    system_settings: { data: { value: "10" }, error: null },
    qbo_sync_log: { data: { id: "log-1" }, error: null },
    ...overrides,
  };
}

/** Install the tables on a fresh admin mock; return its write recorder. */
function useTables(tables: TableData): Write[] {
  const { admin, writes } = makeAdminMock(tables, { onUnknownTable: "throw" });
  mockedCreateAdminClient.mockResolvedValue(admin as never);
  return writes;
}

const postedInvoice = (): QBOInvoice => mockedPost.mock.calls[0][1] as QBOInvoice;

const logWrites = (writes: Write[]) => ({
  insert: writes.find((w) => w.table === "qbo_sync_log" && w.op === "insert")?.row as
    | Record<string, unknown>
    | undefined,
  update: writes.find((w) => w.table === "qbo_sync_log" && w.op === "update")?.row as
    | Record<string, unknown>
    | undefined,
});

beforeEach(() => {
  vi.clearAllMocks();
});

// -----------------------------------------------------------------------------
// Characterization — current happy paths
// -----------------------------------------------------------------------------

describe("syncInvoice — happy paths (characterization)", () => {
  it("creates an Invoice: brand/format description lines, customer terms drive the due date", async () => {
    const writes = useTables(makeTables());
    mockedPost.mockResolvedValue({ Invoice: { Id: "I-9" } });

    const result = await syncInvoice(ORDER_ID);

    expect(result).toEqual({ qboId: "I-9", action: "create" });

    const [path, invoice] = mockedPost.mock.calls[0] as [string, QBOInvoice];
    expect(path).toBe("/invoice?requestid=mgr-i-ord-1");
    expect(invoice).toMatchObject({
      DocNumber: "SO-100",
      CustomerRef: { value: "C-55" },
      TxnDate: "2026-03-01",
      DueDate: "2026-03-15", // customer payment_terms_days = 14
    });
    expect(invoice.Line).toEqual([
      {
        Amount: 360, // 3 × 120
        Description: "Lager - 1/2 BBL Keg",
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: { Qty: 3, UnitPrice: 120 },
      },
      {
        Amount: 60, // 24 × 2.5
        Description: "IPA", // no selling format → brand name only
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: { Qty: 24, UnitPrice: 2.5 },
      },
    ]);
    expect(mockedGet).not.toHaveBeenCalled();

    const upsert = writes.find((w) => w.table === "qbo_sync_mappings" && w.op === "upsert");
    expect(upsert?.row).toMatchObject({
      entity_type: "order",
      entity_id: ORDER_ID,
      qbo_entity_type: "Invoice",
      qbo_entity_id: "I-9",
    });
    const log = logWrites(writes);
    expect(log.insert).toMatchObject({ action: "create", status: "pending" });
    expect(log.update).toMatchObject({ status: "success" });
  });

  it("updates an already-mapped Invoice: fetches the fresh SyncToken and posts a sparse update", async () => {
    const writes = useTables(makeTables({ qbo_sync_mappings: mappingsTable({ existing: orderMapping }) }));
    mockedGet.mockResolvedValue({ Invoice: { SyncToken: "7" } });
    mockedPost.mockResolvedValue({ Invoice: { Id: "I-42" } });

    const result = await syncInvoice(ORDER_ID);

    expect(result).toEqual({ qboId: "I-42", action: "update" });
    expect(mockedGet).toHaveBeenCalledWith("/invoice/I-42");
    expect(postedInvoice()).toMatchObject({ Id: "I-42", SyncToken: "7", sparse: true });
    expect(logWrites(writes).update).toMatchObject({ status: "success" });
  });

  it("refuses to create an empty Invoice when the order genuinely has no line items", async () => {
    useTables(makeTables({ order_items: { data: [], error: null } }));

    await expect(syncInvoice(ORDER_ID)).rejects.toThrow(/has no line items/);
    expect(mockedPost).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// Swallowed-read guards (audit SF-2 / SF-9 / SF-11)
// -----------------------------------------------------------------------------

describe("syncInvoice — failed reads are not treated as empty", () => {
  it("SF-2: a failed mapping read ABORTS with a failed sync-log row — no duplicate Invoice is posted", async () => {
    const writes = useTables(
      makeTables({ qbo_sync_mappings: mappingsTable({ readError: { message: "connection reset" } }) })
    );

    await expect(syncInvoice(ORDER_ID)).rejects.toThrow(
      /Failed to read QBO sync mapping for order ord-1: connection reset/
    );

    // Nothing posted to QuickBooks, no mapping persisted...
    expect(mockedPost).not.toHaveBeenCalled();
    expect(writes.find((w) => w.table === "qbo_sync_mappings" && w.op === "upsert")).toBeUndefined();
    // ...and the abort is recorded in qbo_sync_log as a failed sync.
    const log = logWrites(writes);
    expect(log.insert).toMatchObject({ entity_type: "order", entity_id: ORDER_ID });
    expect(log.update).toMatchObject({ status: "error" });
    expect(log.update?.error_message).toMatch(/Failed to read QBO sync mapping/);
  });

  it("SF-9: a failed order_items read surfaces the real DB error, not 'has no line items'", async () => {
    useTables(makeTables({ order_items: { data: null, error: { message: "socket hang up" } } }));

    const rejection = await syncInvoice(ORDER_ID).then(
      () => null,
      (err: Error) => err
    );

    expect(rejection?.message).toMatch(/Failed to read line items for order SO-100: socket hang up/);
    expect(rejection?.message).not.toMatch(/has no line items/);
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("SF-11: a failed customer payment-terms read falls back to the default terms AND logs it", async () => {
    useTables(makeTables({ customers: { data: null, error: { message: "customer read failed" } } }));
    mockedPost.mockResolvedValue({ Invoice: { Id: "I-9" } });

    const result = await syncInvoice(ORDER_ID);

    expect(result).toEqual({ qboId: "I-9", action: "create" });
    // Default terms from system_settings ("10" days), not the customer's 14.
    expect(postedInvoice().DueDate).toBe("2026-03-11");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: "customer read failed", customerId: CUSTOMER_ID }),
      expect.stringContaining("failed to read customer payment terms")
    );
  });
});

describe("syncInvoice — durable remote creation", () => {
  it("retries a remote success after mapping failure without creating another Invoice", async () => {
    const writes = useTables(
      makeTables({
        qbo_sync_mappings: mappingsTable({
          writeErrors: [{ message: "mapping connection lost" }, null],
        }),
      })
    );
    const remoteByRequestId = new Map<string, string>();
    let remoteCreates = 0;
    mockedPost.mockImplementation(async (path) => {
      const requestId = new URL(path, "https://qbo.invalid").searchParams.get("requestid");
      const key = requestId ?? `unkeyed-${remoteCreates}`;
      if (!remoteByRequestId.has(key)) {
        remoteCreates += 1;
        remoteByRequestId.set(key, "I-9");
      }
      return { Invoice: { Id: remoteByRequestId.get(key) } };
    });

    await expect(syncInvoice(ORDER_ID)).rejects.toThrow(
      /QuickBooks accepted Invoice I-9, but MGR could not save its mapping.*mapping connection lost/
    );
    await expect(syncInvoice(ORDER_ID)).resolves.toEqual({ qboId: "I-9", action: "create" });

    expect(remoteCreates).toBe(1);
    expect(mockedPost).toHaveBeenCalledTimes(2);
    expect(mockedPost.mock.calls.map(([path]) => path)).toEqual([
      "/invoice?requestid=mgr-i-ord-1",
      "/invoice?requestid=mgr-i-ord-1",
    ]);
    const pendingIntents = writes
      .filter((write) => write.table === "qbo_sync_log" && write.op === "insert")
      .map((write) => write.row as Record<string, unknown>);
    expect(pendingIntents[0]?.request_payload).toMatchObject({
      requestId: "mgr-i-ord-1",
      qboEntityType: "Invoice",
      payload: { DocNumber: "SO-100" },
    });
    const reconciliation = writes
      .filter((write) => write.table === "qbo_sync_log" && write.op === "update")
      .map((write) => write.row as Record<string, unknown>)
      .find((row) => row.status === "error");
    expect(reconciliation).toMatchObject({
      status: "error",
      response_payload: { Invoice: { Id: "I-9" } },
    });
    expect(reconciliation?.error_message).toMatch(/remote document exists.*retry/i);
  });

  it("reuses the same request identity after a lost create response", async () => {
    useTables(makeTables());
    const remoteByRequestId = new Map<string, string>();
    let remoteCreates = 0;
    let loseFirstResponse = true;
    mockedPost.mockImplementation(async (path) => {
      const requestId = new URL(path, "https://qbo.invalid").searchParams.get("requestid");
      const key = requestId ?? `unkeyed-${remoteCreates}`;
      if (!remoteByRequestId.has(key)) {
        remoteCreates += 1;
        remoteByRequestId.set(key, "I-9");
      }
      if (loseFirstResponse) {
        loseFirstResponse = false;
        throw new Error("response connection reset");
      }
      return { Invoice: { Id: remoteByRequestId.get(key) } };
    });

    await expect(syncInvoice(ORDER_ID)).rejects.toThrow(/response connection reset/);
    await expect(syncInvoice(ORDER_ID)).resolves.toEqual({ qboId: "I-9", action: "create" });

    expect(remoteCreates).toBe(1);
    expect(mockedPost.mock.calls.map(([path]) => path)).toEqual([
      "/invoice?requestid=mgr-i-ord-1",
      "/invoice?requestid=mgr-i-ord-1",
    ]);
  });
});
