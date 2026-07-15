/** Order change-request approval route regressions (#476). */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const dynamicRpc = vi.hoisted(() => vi.fn());

vi.mock("@/services/types", () => ({ dynamicRpc }));
vi.mock("@/lib/api/auth", () => ({
  withPermission:
    (_permission: string, handler: (...args: never[]) => unknown) =>
    async (
      request: NextRequest,
      context?: { params?: Promise<Record<string, string>> },
    ) => handler(request as never, {
      user: { id: "reviewer-1" },
      supabase: { marker: "user-client" },
      params: context?.params ? await context.params : undefined,
    } as never),
}));

import { POST } from "../route";

const request = new NextRequest(
  "http://localhost/api/orders/order-1/change-requests/request-1/approve",
  { method: "POST" },
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/orders/:id/change-requests/:requestId/approve", () => {
  it("approves through the atomic database command", async () => {
    dynamicRpc.mockResolvedValue({ data: null, error: null });

    const response = await POST(request, {
      params: Promise.resolve({ id: "order-1", requestId: "request-1" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { approved: true } });
    expect(dynamicRpc).toHaveBeenCalledWith(
      { marker: "user-client" },
      "apply_change_request",
      {
        p_order_id: "order-1",
        p_change_request_id: "request-1",
        p_approved_by: "reviewer-1",
      },
    );
  });

  it("returns a structured failure when the database rejects approval", async () => {
    dynamicRpc.mockResolvedValue({
      data: null,
      error: {
        code: "42703",
        details: "The approval function references a removed column",
        message: "column order_items.package_type_id does not exist",
      },
    });

    const response = await POST(request, {
      params: Promise.resolve({ id: "order-1", requestId: "request-1" }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        details: "The approval function references a removed column",
        message: "column order_items.package_type_id does not exist",
      },
    });
  });

  it("rejects a request without a change-request id before calling Postgres", async () => {
    const response = await POST(request, {
      params: Promise.resolve({ id: "order-1" }),
    });

    expect(response.status).toBe(400);
    expect(dynamicRpc).not.toHaveBeenCalled();
  });

  it("returns a conflict when the order changed after submission", async () => {
    dynamicRpc.mockResolvedValue({
      data: null,
      error: {
        code: "40001",
        details: null,
        message: "Order item changed after this request was submitted",
      },
    });

    const response = await POST(request, {
      params: Promise.resolve({ id: "order-1", requestId: "request-1" }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "CONFLICT",
        message: "Order item changed after this request was submitted",
      },
    });
  });
});
