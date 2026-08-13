/**
 * QuickBooks syncCustomer tests.
 *
 * Covers the name-match fallback: when a customer has no local
 * qbo_sync_mappings row but an existing QBO Customer is found by
 * DisplayName, syncCustomer correctly performs a sparse UPDATE against it
 * (never a duplicate create) — but the reported/logged `action` must say
 * "update", not "create", since a "create" placeholder computed before the
 * name lookup does not reflect what actually happened.
 *
 * The Supabase admin client is faked with the shared admin mock
 * (src/test/supabase-admin-mock.ts); the QBO HTTP client is module-mocked.
 */

import { describe, it, expect, vi } from "vitest";
import { makeAdminMock, type TableData, type Write } from "@/test/supabase-admin-mock";

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/integrations/quickbooks/client", () => ({
  qboClient: { get: vi.fn(), post: vi.fn(), query: vi.fn() },
}));

import { createAdminClient } from "@/lib/supabase/server";
import { qboClient } from "@/integrations/quickbooks/client";
import { syncCustomer } from "@/integrations/quickbooks/sync-customer";

const mockedCreateAdminClient = vi.mocked(createAdminClient);
const mockedPost = vi.mocked(qboClient.post);
const mockedGet = vi.mocked(qboClient.get);
const mockedQuery = vi.mocked(qboClient.query);

const CUSTOMER_ID = "cust-1";

const baseCustomer = {
  id: CUSTOMER_ID,
  name: "Acme Taproom",
  email: null,
  phone: null,
  address: null,
  is_tax_exempt: false,
};

function makeTables(overrides: TableData = {}): TableData {
  return {
    customers: { data: baseCustomer, error: null },
    qbo_sync_mappings: { data: null, error: null }, // no local mapping yet
    qbo_sync_log: ({ ops }) => (ops.length ? { data: { id: "log-1" }, error: null } : { data: { id: "log-1" }, error: null }),
    ...overrides,
  };
}

function setupAdmin(tables: TableData) {
  const { admin, writes } = makeAdminMock(tables);
  mockedCreateAdminClient.mockResolvedValue(admin);
  return writes;
}

function findWrite(writes: Write[], table: string, op: Write["op"]) {
  return writes.find((w) => w.table === table && w.op === op);
}

describe("syncCustomer", () => {
  it("reports and logs 'update' — not 'create' — when a pre-existing QBO customer is found by name", async () => {
    const writes = setupAdmin(makeTables());

    // No local mapping, but QBO already has a Customer with this DisplayName
    // (e.g. entered manually, or from a prior sync whose local mapping was lost).
    mockedQuery.mockResolvedValue({
      QueryResponse: { Customer: [{ Id: "QBO-99" }] },
    });
    // sparseUpdateCustomer fetches the current record for its SyncToken...
    mockedGet.mockResolvedValue({ Customer: { Id: "QBO-99", SyncToken: "3" } });
    // ...then posts the sparse update.
    mockedPost.mockResolvedValue({ Customer: { Id: "QBO-99", SyncToken: "4" } });

    const result = await syncCustomer(CUSTOMER_ID);

    expect(result.action).toBe("update");

    // The actual write to QBO must be the sparse update, not a bare create:
    // a real create call is a POST with no prior GET.
    expect(mockedGet).toHaveBeenCalledWith("/customer/QBO-99");
    expect(mockedPost).toHaveBeenCalledWith(
      "/customer",
      expect.objectContaining({ Id: "QBO-99", sparse: true })
    );

    // The durable audit trail (qbo_sync_log) must not say "create" for a
    // sync that resolved to an update.
    const logUpdate = findWrite(writes, "qbo_sync_log", "update");
    expect(logUpdate?.row).toMatchObject({ status: "success" });
    expect((logUpdate?.row as Record<string, unknown>).action).not.toBe("create");
  });
});
