/** API-boundary tests for Beer Orders file validation and immutable run-ID apply. */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeAdminMock } from "@/test/supabase-admin-mock";

vi.mock("@/lib/api/auth", () => ({
  withPermission:
    (_permission: string, handler: (request: Request, context: unknown) => unknown) =>
    (request: Request) => handler(request, { user: { id: "user-1" } }),
}));

vi.mock("@/lib/supabase/server", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/integrations/beer-orders/parser", () => ({ parseBeerOrderWorkbook: vi.fn() }));
vi.mock("@/integrations/beer-orders/reference-data", () => ({ loadBeerOrderReferenceData: vi.fn() }));
vi.mock("@/integrations/beer-orders/planner", () => ({ buildBeerOrderImportPlan: vi.fn() }));

import { createAdminClient } from "@/lib/supabase/server";
import { parseBeerOrderWorkbook } from "@/integrations/beer-orders/parser";
import { buildBeerOrderImportPlan } from "@/integrations/beer-orders/planner";
import { POST as preview } from "@/app/api/integrations/beer-orders/preview/route";
import { POST as apply } from "@/app/api/integrations/beer-orders/apply/route";

const RUN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const summary = {
  sourceOrders: 1,
  sourceLines: 1,
  plannedOrders: 1,
  plannedLines: 1,
  createdOrders: 1,
  updatedOrders: 0,
  unchangedOrders: 0,
  customersToCreate: 0,
  staleOrders: 0,
  skippedInternalBlocks: 0,
  skippedInactiveBlocks: 0,
};
const plan = {
  version: 1,
  ready: true,
  summary,
  unresolved: { customers: [], brands: [] },
  options: { customers: [], brands: [] },
  customersToCreate: [],
  customerMappings: [],
  brandMappings: [],
  orders: [],
  staleOrders: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(parseBeerOrderWorkbook).mockResolvedValue({} as never);
  vi.mocked(buildBeerOrderImportPlan).mockReturnValue(plan as never);
});

describe("Beer Orders integration routes", () => {
  it("rejects non-xlsx uploads before parsing", async () => {
    const file = new File(["orders"], "orders.csv", { type: "text/csv" });
    const response = await preview({
      formData: async () => ({ get: (key: string) => key === "file" ? file : null }),
    } as never);

    expect(response.status).toBe(415);
    expect(vi.mocked(parseBeerOrderWorkbook)).not.toHaveBeenCalled();
  });

  it("persists a server-authored preview rather than accepting a client plan", async () => {
    const mock = makeAdminMock({ beer_order_import_runs: { data: { id: RUN_ID }, error: null } });
    vi.mocked(createAdminClient).mockResolvedValue(mock.admin);
    const file = new File(["orders"], "Beer orders.xlsx");
    const response = await preview({
      formData: async () => ({
        get: (key: string) => key === "file"
          ? file
          : key === "plan"
            ? JSON.stringify({ orders: [{ id: "attacker-plan" }] })
            : null,
      }),
    } as never);
    expect(response.status).toBe(200);
    expect(mock.writes[0]).toMatchObject({
      table: "beer_order_import_runs",
      op: "insert",
      row: expect.objectContaining({ plan }),
    });
  });

  it("applies only a stored preview run ID through the atomic RPC", async () => {
    const mock = makeAdminMock({}, { rpc: { data: summary, error: null } });
    vi.mocked(createAdminClient).mockResolvedValue(mock.admin);
    const response = await apply(new Request("http://localhost/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: RUN_ID, plan: { orders: [{ id: "attacker-plan" }] } }),
    }) as never);

    expect(response.status).toBe(200);
    expect(mock.rpcCalls).toEqual([{ fn: "apply_beer_order_import", args: { p_run_id: RUN_ID } }]);
  });
});
