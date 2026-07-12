/**
 * QuickBooks syncBill tests — characterization of the happy paths (create /
 * update / configured fallbacks) plus the swallowed-read guards from the
 * 2026-07-10 silent-failure audit:
 *
 *   SF-2  a failed qbo_sync_mappings read must ABORT the sync (recorded as a
 *         failed sync-log row), never fall through to "create" — falling
 *         through posts a duplicate Bill into QuickBooks.
 *   SF-3  a failed po_line_items read must throw, not produce a Bill that
 *         contains only the shipping line (COGS silently omitted).
 *   SF-7  a failed 'shipping' account-mapping read still falls back to the
 *         COGS account, but logs a warning DISTINCT from the genuinely
 *         unconfigured case.
 *   SF-11 a failed supplier payment-terms read still falls back to the
 *         default terms, but logs a warning naming the failed read.
 *
 * The Supabase admin client is faked with the shared admin mock
 * (src/test/supabase-admin-mock.ts); the QBO HTTP client and syncSupplier are
 * module-mocked. Assertions are on the payloads posted to QBO and the rows
 * written to qbo_sync_mappings / qbo_sync_log, not on mock call counts.
 *
 * NOTE on DueDate strings: vitest.config pins TZ=America/New_York, and
 * addDays parses date-only strings as UTC midnight but adds days in LOCAL
 * time — so "2026-03-01" + N days lands one calendar day earlier than naive
 * UTC arithmetic (e.g. +45 → "2026-04-14", not "-15"). The hardcoded
 * expectations below characterize that existing behavior under the pinned TZ.
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

vi.mock("@/integrations/quickbooks/sync-supplier", () => ({
  syncSupplier: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { qboClient } from "@/integrations/quickbooks/client";
import { syncBill } from "@/integrations/quickbooks/sync-bill";
import type { QBOBill } from "@/integrations/quickbooks/types";

const mockedCreateAdminClient = vi.mocked(createAdminClient);
const mockedPost = vi.mocked(qboClient.post);
const mockedGet = vi.mocked(qboClient.get);

const PO_ID = "po-1";
const SUPPLIER_ID = "sup-1";

const basePO = {
  id: PO_ID,
  po_number: "PO-1001",
  supplier_id: SUPPLIER_ID,
  order_date: "2026-03-01",
  shipping_cost: 25,
};

const supplierMapping = {
  id: "map-sup",
  entity_type: "supplier",
  entity_id: SUPPLIER_ID,
  qbo_entity_type: "Vendor",
  qbo_entity_id: "V-77",
  last_synced_at: "2026-01-01T00:00:00Z",
};

const poMapping = {
  id: "map-po",
  entity_type: "purchase_order",
  entity_id: PO_ID,
  qbo_entity_type: "Bill",
  qbo_entity_id: "B-42",
  last_synced_at: "2026-01-01T00:00:00Z",
};

type ErrorLike = { message: string };

/**
 * qbo_sync_mappings responder. getMapping hits this table for BOTH the
 * supplier precondition and the create-vs-update decision — distinguish by
 * the eq("entity_type", ...) filter, and let upsertMapping's write resolve
 * empty.
 */
function mappingsTable(opts: { existing?: typeof poMapping | null; readError?: ErrorLike } = {}) {
  return ({ calls, ops }: { calls: { method: string; args: unknown[] }[]; ops: string[] }) => {
    if (ops.length) return { data: null, error: null }; // upsertMapping write
    const entityType = calls.find((c) => c.method === "eq" && c.args[0] === "entity_type")?.args[1];
    if (entityType === "supplier") return { data: supplierMapping, error: null };
    if (entityType === "purchase_order") {
      if (opts.readError) return { data: null, error: opts.readError };
      return { data: opts.existing ?? null, error: null };
    }
    return { data: null, error: null };
  };
}

/** qbo_account_mappings responder — cogs always configured; shipping varies. */
function accountMappingsTable(
  opts: { shipping?: { qbo_account_id: string } | null; shippingError?: ErrorLike } = {
    shipping: { qbo_account_id: "ACC-SHIP" },
  }
) {
  return ({ calls }: { calls: { method: string; args: unknown[] }[] }) => {
    const category = calls.find((c) => c.method === "eq" && c.args[0] === "category")?.args[1];
    if (category === "cogs") return { data: { qbo_account_id: "ACC-COGS" }, error: null };
    if (category === "shipping") {
      if (opts.shippingError) return { data: null, error: opts.shippingError };
      return { data: opts.shipping ?? null, error: null };
    }
    return { data: null, error: null };
  };
}

function makeTables(overrides: TableData = {}): TableData {
  return {
    purchase_orders: { data: basePO, error: null },
    qbo_sync_mappings: mappingsTable(),
    qbo_account_mappings: accountMappingsTable(),
    po_line_items: {
      data: [
        { catalog_type: "malt", catalog_id: "2-row", quantity: 10, unit_price: "5.5" },
        { catalog_type: "hop", catalog_id: "citra", quantity: 2, unit_price: "30" },
      ],
      error: null,
    },
    suppliers: { data: { payment_terms: "Net 45" }, error: null },
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

const postedBill = (): QBOBill => mockedPost.mock.calls[0][1] as QBOBill;

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

describe("syncBill — happy paths (characterization)", () => {
  it("creates a Bill: one COGS line per PO line item + shipping on the shipping account, Net-45 due date", async () => {
    const writes = useTables(makeTables());
    mockedPost.mockResolvedValue({ Bill: { Id: "B-9" } });

    const result = await syncBill(PO_ID);

    expect(result).toEqual({ qboId: "B-9", action: "create" });

    const [path, bill] = mockedPost.mock.calls[0] as [string, QBOBill];
    expect(path).toBe("/bill");
    expect(bill).toMatchObject({
      DocNumber: "PO-1001",
      VendorRef: { value: "V-77" },
      TxnDate: "2026-03-01",
      DueDate: "2026-04-14", // "Net 45" parsed from supplier payment_terms (see TZ note)
    });
    expect(bill.Line).toEqual([
      {
        Amount: 55, // 10 × 5.5
        Description: "malt - 2-row",
        DetailType: "AccountBasedExpenseLineDetail",
        AccountBasedExpenseLineDetail: { AccountRef: { value: "ACC-COGS" } },
      },
      {
        Amount: 60, // 2 × 30
        Description: "hop - citra",
        DetailType: "AccountBasedExpenseLineDetail",
        AccountBasedExpenseLineDetail: { AccountRef: { value: "ACC-COGS" } },
      },
      {
        Amount: 25,
        Description: "Shipping",
        DetailType: "AccountBasedExpenseLineDetail",
        AccountBasedExpenseLineDetail: { AccountRef: { value: "ACC-SHIP" } },
      },
    ]);
    // No update-path GET for a first-time sync.
    expect(mockedGet).not.toHaveBeenCalled();

    // Mapping persisted and the sync log closed out as success.
    const upsert = writes.find((w) => w.table === "qbo_sync_mappings" && w.op === "upsert");
    expect(upsert?.row).toMatchObject({
      entity_type: "purchase_order",
      entity_id: PO_ID,
      qbo_entity_type: "Bill",
      qbo_entity_id: "B-9",
    });
    const log = logWrites(writes);
    expect(log.insert).toMatchObject({ action: "create", status: "pending" });
    expect(log.update).toMatchObject({ status: "success" });
  });

  it("updates an already-mapped Bill: fetches the fresh SyncToken and posts a sparse update", async () => {
    const writes = useTables(makeTables({ qbo_sync_mappings: mappingsTable({ existing: poMapping }) }));
    mockedGet.mockResolvedValue({ Bill: { SyncToken: "3" } });
    mockedPost.mockResolvedValue({ Bill: { Id: "B-42" } });

    const result = await syncBill(PO_ID);

    expect(result).toEqual({ qboId: "B-42", action: "update" });
    expect(mockedGet).toHaveBeenCalledWith("/bill/B-42");
    expect(postedBill()).toMatchObject({ Id: "B-42", SyncToken: "3", sparse: true });
    expect(logWrites(writes).update).toMatchObject({ status: "success" });
  });

  it("posts shipping to the COGS account when no 'shipping' account mapping is configured", async () => {
    useTables(makeTables({ qbo_account_mappings: accountMappingsTable({ shipping: null }) }));
    mockedPost.mockResolvedValue({ Bill: { Id: "B-9" } });

    await syncBill(PO_ID);

    const shippingLine = postedBill().Line.find((l) => l.Description === "Shipping");
    expect(shippingLine?.AccountBasedExpenseLineDetail.AccountRef).toEqual({ value: "ACC-COGS" });
  });

  it("refuses to create an empty Bill when the PO genuinely has no line items and no shipping", async () => {
    useTables(
      makeTables({
        purchase_orders: { data: { ...basePO, shipping_cost: 0 }, error: null },
        po_line_items: { data: [], error: null },
      })
    );

    await expect(syncBill(PO_ID)).rejects.toThrow(/has no line items/);
    expect(mockedPost).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// Swallowed-read guards (audit SF-2 / SF-3 / SF-7 / SF-11)
// -----------------------------------------------------------------------------

describe("syncBill — failed reads are not treated as empty", () => {
  it("SF-2: a failed mapping read ABORTS with a failed sync-log row — no duplicate Bill is posted", async () => {
    const writes = useTables(
      makeTables({ qbo_sync_mappings: mappingsTable({ readError: { message: "connection reset" } }) })
    );

    await expect(syncBill(PO_ID)).rejects.toThrow(
      /Failed to read QBO sync mapping for purchase_order po-1: connection reset/
    );

    // Nothing posted to QuickBooks, no mapping persisted...
    expect(mockedPost).not.toHaveBeenCalled();
    expect(writes.find((w) => w.table === "qbo_sync_mappings" && w.op === "upsert")).toBeUndefined();
    // ...and the abort is recorded in qbo_sync_log as a failed sync.
    const log = logWrites(writes);
    expect(log.insert).toMatchObject({ entity_type: "purchase_order", entity_id: PO_ID });
    expect(log.update).toMatchObject({ status: "error" });
    expect(log.update?.error_message).toMatch(/Failed to read QBO sync mapping/);
  });

  it("SF-3: a failed po_line_items read with shipping > 0 throws — never a shipping-only Bill", async () => {
    useTables(makeTables({ po_line_items: { data: null, error: { message: "read timeout" } } }));

    await expect(syncBill(PO_ID)).rejects.toThrow(
      /Failed to read line items for purchase order PO-1001: read timeout/
    );
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("SF-7: a failed 'shipping' account-mapping read still bills shipping to COGS, but logs the failed lookup", async () => {
    useTables(
      makeTables({
        qbo_account_mappings: accountMappingsTable({ shippingError: { message: "pg down" } }),
      })
    );
    mockedPost.mockResolvedValue({ Bill: { Id: "B-9" } });

    await syncBill(PO_ID);

    const shippingLine = postedBill().Line.find((l) => l.Description === "Shipping");
    expect(shippingLine?.AccountBasedExpenseLineDetail.AccountRef).toEqual({ value: "ACC-COGS" });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: "pg down" }),
      expect.stringContaining("failed to read 'shipping' account mapping")
    );
  });

  it("SF-7: a genuinely unconfigured 'shipping' mapping logs a DISTINCT warning from the failed lookup", async () => {
    useTables(makeTables({ qbo_account_mappings: accountMappingsTable({ shipping: null }) }));
    mockedPost.mockResolvedValue({ Bill: { Id: "B-9" } });

    await syncBill(PO_ID);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ purchaseOrderId: PO_ID }),
      expect.stringContaining("no 'shipping' account mapping configured")
    );
    // Not misreported as a read failure.
    const warned = vi.mocked(logger.warn).mock.calls.map((c) => c[1]);
    expect(warned.some((m) => String(m).includes("failed to read"))).toBe(false);
  });

  it("SF-11: a failed supplier payment-terms read falls back to the default terms AND logs it", async () => {
    useTables(makeTables({ suppliers: { data: null, error: { message: "supplier read failed" } } }));
    mockedPost.mockResolvedValue({ Bill: { Id: "B-9" } });

    const result = await syncBill(PO_ID);

    expect(result).toEqual({ qboId: "B-9", action: "create" });
    // Default terms from system_settings ("10" days), not the supplier's Net 45.
    expect(postedBill().DueDate).toBe("2026-03-10");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: "supplier read failed", supplierId: SUPPLIER_ID }),
      expect.stringContaining("failed to read supplier payment terms")
    );
  });
});
