/**
 * GET /api/square/sync/status — pending draft-sale count (#608).
 *
 * The `unreconciledDraftSales` figure drives the "N unreconciled" badge and the
 * enabled/disabled state of the Reconcile button on Settings -> Integrations,
 * so it must equal the exact number of rows POST
 * /api/square/reconcile-draft-sales would process. The reconciler filters
 * `reconciled_at IS NULL AND voided_at IS NULL`; this route once filtered only
 * on `reconciled_at`, so a refund-voided pour — which nothing ever stamps
 * `reconciled_at` — was counted forever with no admin action able to clear it.
 *
 * The `square_draft_sales` response below honors the `.is()` filters the route
 * actually applies, so dropping either predicate changes the count and fails.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeAdminMock, type QueryResult, type TableData } from "@/test/supabase-admin-mock";

// -----------------------------------------------------------------------------
// Mocks (must precede route imports)
// -----------------------------------------------------------------------------

vi.mock("@/lib/api/auth", () => ({
  withPermission:
    (_perm: string, handler: (req: unknown, ctx: unknown) => unknown) =>
    (req: unknown) =>
      handler(req, { user: { id: "user-1" } }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/integrations/square/client", () => ({
  updateSquareSettingsOrThrow: vi.fn().mockResolvedValue(undefined),
}));

import { createAdminClient } from "@/lib/supabase/server";
import { GET } from "@/app/api/square/sync/status/route";

const mockedCreateAdminClient = vi.mocked(createAdminClient);

type DraftRow = {
  id: string;
  reconciled_at: string | null;
  voided_at: string | null;
};

/** Mixed queue state: one genuine backlog row, one refund-voided, one done. */
const DRAFT_ROWS: DraftRow[] = [
  { id: "pending", reconciled_at: null, voided_at: null },
  { id: "refund-voided", reconciled_at: null, voided_at: "2026-07-20T00:00:00.000Z" },
  { id: "reconciled", reconciled_at: "2026-07-19T00:00:00.000Z", voided_at: null },
];

function useTables(rows: DraftRow[] = DRAFT_ROWS) {
  const tables: TableData = {
    square_settings_safe: {
      data: {
        is_enabled: true,
        last_catalog_sync_at: null,
        last_inventory_sync_at: null,
      },
      error: null,
    },
    square_catalog_map: { data: null, error: null },
    square_sync_log: { data: [], error: null },
    bins: { data: [], error: null },
    // Counts only the rows that satisfy every `.is(column, value)` the route
    // applied — a faithful stand-in for a PostgREST head+exact count.
    square_draft_sales: ({ calls }) => {
      const isFilters = calls.filter((c) => c.method === "is");
      const matched = rows.filter((row) =>
        isFilters.every(
          (f) => (row as unknown as Record<string, unknown>)[f.args[0] as string] === f.args[1],
        ),
      );
      return { data: null, error: null, count: matched.length } as QueryResult;
    },
  };
  const mock = makeAdminMock(tables);
  mockedCreateAdminClient.mockResolvedValue(mock.admin as never);
}

const get = async () => {
  const res = await GET(new NextRequest("http://localhost/api/square/sync/status"));
  return (await res.json()) as { data: { unreconciledDraftSales: number } };
};

beforeEach(() => {
  vi.clearAllMocks();
  useTables();
});

describe("Square sync status: unreconciled draft-sale count (#608)", () => {
  it("counts only rows the reconciler would process", async () => {
    const body = await get();
    // Exactly the "pending" row: the refund-voided one is terminal, the
    // reconciled one is done.
    expect(body.data.unreconciledDraftSales).toBe(1);
  });

  it("does not count a refund-voided pour, so the badge can reach zero", async () => {
    useTables([
      { id: "refund-voided", reconciled_at: null, voided_at: "2026-07-20T00:00:00.000Z" },
    ]);
    const body = await get();
    expect(body.data.unreconciledDraftSales).toBe(0);
  });

  it("still counts a partial-refund row, which 00268 intentionally leaves un-voided", async () => {
    useTables([{ id: "partial", reconciled_at: null, voided_at: null }]);
    const body = await get();
    expect(body.data.unreconciledDraftSales).toBe(1);
  });
});
