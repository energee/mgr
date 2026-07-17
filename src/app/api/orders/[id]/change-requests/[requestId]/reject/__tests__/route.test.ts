/** Reject-route scoping and stale-state regressions for issue #488. */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeSupabase, type QueuedResponse } from "@/test/supabase-mock";

const fixture = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: null as any,
}));

vi.mock("@/lib/api/auth", () => ({
  withPermission:
    (_permission: string, handler: (...args: never[]) => unknown) =>
    async (
      request: NextRequest,
      context?: { params?: Promise<Record<string, string>> },
    ) => handler(request as never, {
      user: { id: "reviewer-1" },
      supabase: fixture.supabase,
      params: context?.params ? await context.params : undefined,
    } as never),
}));

import { POST } from "../route";

const RPC = "reject_order_change_request";
const ORDER_ID = "order-1";
const REQUEST_ID = "request-1";

function request(reason: unknown = "  Inventory unavailable  ") {
  return new NextRequest(
    `http://localhost/api/orders/${ORDER_ID}/change-requests/${REQUEST_ID}/reject`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    },
  );
}

function callRoute() {
  return POST(request(), {
    params: Promise.resolve({ id: ORDER_ID, requestId: REQUEST_ID }),
  });
}

function setup(response: QueuedResponse) {
  const sb = makeSupabase({}, { [RPC]: [response] });
  fixture.supabase = sb.supabase;
  return sb;
}

beforeEach(() => {
  fixture.supabase = null;
});

describe("POST /api/orders/:id/change-requests/:requestId/reject", () => {
  it("scopes the atomic rejection by both URL identifiers", async () => {
    const sb = setup({ data: REQUEST_ID, error: null });

    const response = await callRoute();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { rejected: true } });
    expect(sb.rpcSpy).toHaveBeenCalledWith(RPC, {
      p_order_id: ORDER_ID,
      p_change_request_id: REQUEST_ID,
      p_reason: "Inventory unavailable",
    });
    expect(sb.fromSpy).not.toHaveBeenCalled();
  });

  it("returns 404 when the request does not belong to the URL order", async () => {
    setup({
      data: null,
      error: { code: "P0002", message: "Change request not found" },
    });

    const response = await callRoute();

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("NOT_FOUND");
  });

  it("returns 409 instead of success for an already-reviewed request", async () => {
    setup({
      data: null,
      error: { code: "PT409", message: "Change request is not pending" },
    });

    const response = await callRoute();

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("CONFLICT");
  });
});
