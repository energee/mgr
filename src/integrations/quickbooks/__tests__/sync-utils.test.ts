/**
 * QuickBooks sync-utils tests — the shared read helpers hardened by the
 * 2026-07-10 silent-failure audit:
 *
 *   getMapping (SF-2)                 a failed qbo_sync_mappings READ throws;
 *                                     only a genuinely absent row returns null
 *                                     (null means "create a new QBO document"
 *                                     to callers, so error≡null posts
 *                                     duplicates).
 *   getMappingOrLogFailure (SF-2)     same, but the failure is also recorded
 *                                     as a failed attempt in qbo_sync_log —
 *                                     and a failing log write never masks the
 *                                     original read error.
 *   getDefaultPaymentTermsDays (SF-11) missing setting silently defaults to
 *                                     30; a failed READ also defaults but
 *                                     logs a warning naming the read.
 *
 * mapAddress is covered separately in
 * src/components/domain/order/__tests__/customer-address-section.test.ts.
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

import { createAdminClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import {
  getMapping,
  getMappingOrLogFailure,
  getDefaultPaymentTermsDays,
  upsertMapping,
  updateSyncLog,
} from "@/integrations/quickbooks/sync-utils";

const mockedCreateAdminClient = vi.mocked(createAdminClient);

const mapping = {
  id: "map-1",
  entity_type: "customer",
  entity_id: "cust-1",
  qbo_entity_type: "Customer",
  qbo_entity_id: "C-55",
  last_synced_at: "2026-01-01T00:00:00Z",
};

/** Install the tables on a fresh admin mock; return its write recorder. */
function useTables(tables: TableData): Write[] {
  const { admin, writes } = makeAdminMock(tables, { onUnknownTable: "throw" });
  mockedCreateAdminClient.mockResolvedValue(admin as never);
  return writes;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getMapping", () => {
  it("returns the mapping row when one exists", async () => {
    useTables({ qbo_sync_mappings: { data: mapping, error: null } });
    await expect(getMapping("customer", "cust-1")).resolves.toEqual(mapping);
  });

  it("returns null only when the row is genuinely absent", async () => {
    useTables({ qbo_sync_mappings: { data: null, error: null } });
    await expect(getMapping("customer", "cust-1")).resolves.toBeNull();
  });

  it("SF-2: throws on a failed read instead of returning null", async () => {
    useTables({ qbo_sync_mappings: { data: null, error: { message: "db down" } } });
    await expect(getMapping("supplier", "sup-1")).rejects.toThrow(
      /Failed to read QBO sync mapping for supplier sup-1: db down/
    );
  });
});

describe("getMappingOrLogFailure", () => {
  it("passes through a successful lookup without touching qbo_sync_log", async () => {
    const writes = useTables({ qbo_sync_mappings: { data: mapping, error: null } });
    await expect(getMappingOrLogFailure("customer", "cust-1")).resolves.toEqual(mapping);
    expect(writes.filter((w) => w.table === "qbo_sync_log")).toEqual([]);
  });

  it("SF-2: records a failed sync-log row before rethrowing a failed read", async () => {
    const writes = useTables({
      qbo_sync_mappings: { data: null, error: { message: "db down" } },
      qbo_sync_log: { data: { id: "log-1" }, error: null },
    });

    await expect(getMappingOrLogFailure("order", "ord-1")).rejects.toThrow(
      /Failed to read QBO sync mapping for order ord-1: db down/
    );

    const insert = writes.find((w) => w.table === "qbo_sync_log" && w.op === "insert")?.row as
      | Record<string, unknown>
      | undefined;
    const update = writes.find((w) => w.table === "qbo_sync_log" && w.op === "update")?.row as
      | Record<string, unknown>
      | undefined;
    expect(insert).toMatchObject({ entity_type: "order", entity_id: "ord-1" });
    expect(update).toMatchObject({ status: "error" });
    expect(update?.error_message).toMatch(/Failed to read QBO sync mapping/);
  });

  it("SF-2: a failing log write preserves and propagates both failures", async () => {
    useTables({
      qbo_sync_mappings: { data: null, error: { message: "db down" } },
      qbo_sync_log: { data: null, error: { message: "insert also failed" } },
    });

    const rejection = await getMappingOrLogFailure("order", "ord-1").then(
      () => null,
      (error: Error) => error
    );
    expect(rejection?.message).toMatch(/Failed to read QBO sync mapping for order ord-1: db down/);
    expect(rejection?.message).toMatch(/Failed to create sync log: insert also failed/);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "order", entityId: "ord-1" }),
      expect.stringContaining("could not record failed mapping lookup")
    );
  });
});

describe("durable sync writes", () => {
  it("propagates a qbo_sync_mappings write failure", async () => {
    useTables({
      qbo_sync_mappings: { data: null, error: { message: "mapping write failed" } },
    });

    await expect(
      upsertMapping("order", "ord-1", "Invoice", "I-9")
    ).rejects.toThrow(/Failed to persist QBO sync mapping.*mapping write failed/);
  });

  it("propagates a qbo_sync_log update failure", async () => {
    useTables({
      qbo_sync_log: { data: null, error: { message: "log update failed" } },
    });

    await expect(
      updateSyncLog("log-1", "success", { Invoice: { Id: "I-9" } })
    ).rejects.toThrow(/Failed to update QBO sync log log-1.*log update failed/);
  });
});

describe("getDefaultPaymentTermsDays", () => {
  it("parses the configured setting", async () => {
    useTables({ system_settings: { data: { value: "45" }, error: null } });
    await expect(getDefaultPaymentTermsDays()).resolves.toBe(45);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("defaults to 30 silently when the setting is genuinely absent", async () => {
    useTables({ system_settings: { data: null, error: null } });
    await expect(getDefaultPaymentTermsDays()).resolves.toBe(30);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("SF-11: defaults to 30 on a failed read, but logs a warning naming the read", async () => {
    useTables({ system_settings: { data: null, error: { message: "pg down" } } });
    await expect(getDefaultPaymentTermsDays()).resolves.toBe(30);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: "pg down" }),
      expect.stringContaining("default_payment_terms_days")
    );
  });
});
