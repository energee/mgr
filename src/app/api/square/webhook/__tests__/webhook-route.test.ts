/**
 * Route-level contract tests for atomic Square ingestion (#443).
 *
 * PostgreSQL integration tests own the ledger/bin/claim rollback assertions.
 * These tests pin the HTTP boundary: signature and replay protection, Square
 * order normalization before the transaction, one atomic RPC per delivery,
 * retry signaling, and the informational inventory-event path.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/integrations/square/client", () => ({
  getSquareClient: vi.fn(),
  getSquareSettings: vi.fn(),
}));

vi.mock("@/integrations/square/webhook", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/integrations/square/webhook")>();
  return {
    ...actual,
    verifyWebhookSignature: vi.fn().mockReturnValue(true),
  };
});

import { getSquareClient, getSquareSettings } from "@/integrations/square/client";
import {
  verifyWebhookSignature,
} from "@/integrations/square/webhook";
import { createAdminClient } from "@/lib/supabase/server";
import { POST } from "@/app/api/square/webhook/route";

const mockedCreateAdminClient = vi.mocked(createAdminClient);
const mockedGetSquareClient = vi.mocked(getSquareClient);
const mockedGetSquareSettings = vi.mocked(getSquareSettings);
const mockedVerifySignature = vi.mocked(verifyWebhookSignature);

const rpc = vi.fn();
const upsert = vi.fn();
const from = vi.fn(() => ({ upsert }));
const orderGet = vi.fn();

const PAYMENT_EVENT = {
  merchant_id: "MERCHANT-1",
  type: "payment.updated",
  event_id: "evt-payment-1",
  created_at: new Date().toISOString(),
  data: {
    type: "payment",
    id: "obj-1",
    object: {
      payment: {
        id: "payment-1",
        order_id: "order-1",
        location_id: "square-location-1",
        status: "COMPLETED",
      },
    },
  },
};

const REFUND_EVENT = {
  merchant_id: "MERCHANT-1",
  type: "refund.updated",
  event_id: "evt-refund-1",
  created_at: new Date().toISOString(),
  data: {
    type: "refund",
    id: "obj-refund-1",
    object: {
      refund: {
        id: "refund-1",
        order_id: "order-1",
        payment_id: "payment-1",
        location_id: "square-location-1",
        status: "COMPLETED",
        amount_money: { amount: "900" },
      },
    },
  },
};

function paymentEvent(
  overrides: Partial<(typeof PAYMENT_EVENT)["data"]["object"]["payment"]> = {},
) {
  return {
    ...PAYMENT_EVENT,
    created_at: new Date().toISOString(),
    data: {
      ...PAYMENT_EVENT.data,
      object: {
        payment: { ...PAYMENT_EVENT.data.object.payment, ...overrides },
      },
    },
  };
}

function refundEvent(
  overrides: Partial<(typeof REFUND_EVENT)["data"]["object"]["refund"]> = {},
) {
  return {
    ...REFUND_EVENT,
    created_at: new Date().toISOString(),
    data: {
      ...REFUND_EVENT.data,
      object: {
        refund: { ...REFUND_EVENT.data.object.refund, ...overrides },
      },
    },
  };
}

function request(body: string, withSignature = true) {
  return new NextRequest("http://localhost/api/square/webhook", {
    method: "POST",
    headers: withSignature ? { "x-square-hmacsha256-signature": "signature" } : {},
    body,
  });
}

function post(event: unknown) {
  return POST(request(JSON.stringify(event)));
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost";
  delete process.env.SQUARE_WEBHOOK_URL;

  mockedGetSquareSettings.mockResolvedValue({
    accessToken: "token",
    webhookSignatureKey: "secret",
    isEnabled: true,
    lastCatalogSyncAt: null,
    lastInventorySyncAt: null,
  });
  mockedVerifySignature.mockReturnValue(true);
  orderGet.mockResolvedValue({
    order: {
      lineItems: [
        {
          uid: "line-1",
          catalogObjectId: "variation-1",
          quantity: "3",
          basePriceMoney: { amount: 1800 },
        },
        { uid: "custom-line", quantity: "1" },
      ],
      totalMoney: { amount: 2400 },
    },
  });
  mockedGetSquareClient.mockResolvedValue({ orders: { get: orderGet } } as never);

  rpc.mockResolvedValue({
    data: { kind: "processed", items_synced: 1, items_failed: 0 },
    error: null,
  });
  upsert.mockResolvedValue({ data: [], error: null });
  mockedCreateAdminClient.mockResolvedValue({ rpc, from } as never);
});

describe("Square webhook request validation", () => {
  it("rejects a missing signature before reading settings", async () => {
    const response = await POST(request(JSON.stringify(PAYMENT_EVENT), false));
    expect(response.status).toBe(400);
    expect(mockedGetSquareSettings).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature", async () => {
    mockedVerifySignature.mockReturnValue(false);
    const response = await post(PAYMENT_EVENT);
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON after signature verification", async () => {
    const response = await POST(request("not-json"));
    expect(response.status).toBe(400);
  });

  it("fails closed when the signature key is missing", async () => {
    mockedGetSquareSettings.mockResolvedValue(null);
    const response = await post(PAYMENT_EVENT);
    expect(response.status).toBe(400);
  });
});

describe("completed payment ingestion", () => {
  it("normalizes the Square order and invokes only the atomic sale RPC", async () => {
    const response = await post(paymentEvent());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(orderGet).toHaveBeenCalledWith({ orderId: "order-1" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("ingest_square_sale_atomic", {
      p_claim_key: "order-1",
      p_event_id: "evt-payment-1",
      p_order_id: "order-1",
      p_payment_id: "payment-1",
      p_square_location_id: "square-location-1",
      p_sold_at: expect.any(String),
      p_lines: [
        {
          uid: "line-1",
          catalog_object_id: "variation-1",
          quantity: "3",
          unit_price_cents: 1800,
        },
        {
          uid: "custom-line",
          catalog_object_id: null,
          quantity: "1",
          unit_price_cents: 0,
        },
      ],
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("passes an empty line array through so the claim finalizes atomically", async () => {
    orderGet.mockResolvedValue({ order: { lineItems: [] } });
    const response = await post(paymentEvent());

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "ingest_square_sale_atomic",
      expect.objectContaining({ p_lines: [] }),
    );
  });

  it("surfaces oversold lines returned by the transaction", async () => {
    const oversold = {
      lineItemUid: "line-1",
      brandId: "brand-1",
      sellingFormatId: "format-1",
      soldQty: 3,
      binQuantityBefore: 1,
      shortfallQty: 2,
    };
    rpc.mockResolvedValue({
      data: { kind: "processed", oversold_lines: [oversold] },
      error: null,
    });

    const response = await post(paymentEvent());
    expect(await response.json()).toEqual({ received: true, oversoldLines: [oversold] });
  });

  it("returns 503 with Retry-After while the transaction claim is in flight", async () => {
    rpc.mockResolvedValue({
      data: { kind: "in_flight", retry_after_seconds: 19 },
      error: null,
    });

    const response = await post(paymentEvent());
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("19");
    expect(await response.json()).toEqual({ error: "sale_claim_in_flight" });
  });

  it.each(["duplicate", "manual_reconcile"] as const)(
    "acknowledges a %s result without performing direct table writes",
    async (kind) => {
      rpc.mockResolvedValue({ data: { kind }, error: null });
      const response = await post(paymentEvent());
      expect(response.status).toBe(200);
      expect(from).not.toHaveBeenCalled();
    },
  );

  it("returns 500 when the atomic RPC rolls back", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "injected finalization failure" },
    });
    const response = await post(paymentEvent());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "processing_failed" });
  });

  it("does not begin the transaction when Square order retrieval fails", async () => {
    orderGet.mockRejectedValue(new Error("Square unavailable"));
    const response = await post(paymentEvent());
    expect(response.status).toBe(500);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("ignores a non-completed or order-less payment before external or database work", async () => {
    const pending = await post(paymentEvent({ status: "PENDING" }));
    const orderless = await post(paymentEvent({ order_id: undefined }));

    expect(pending.status).toBe(200);
    expect(orderless.status).toBe(200);
    expect(orderGet).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("lets the database deduplicate split-tender deliveries by order id", async () => {
    rpc
      .mockResolvedValueOnce({ data: { kind: "processed" }, error: null })
      .mockResolvedValueOnce({ data: { kind: "duplicate" }, error: null });

    const first = await post(paymentEvent({ id: "tender-1" }));
    const second = await post(paymentEvent({ id: "tender-2" }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "ingest_square_sale_atomic",
      expect.objectContaining({ p_claim_key: "order-1", p_payment_id: "tender-1" }),
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "ingest_square_sale_atomic",
      expect.objectContaining({ p_claim_key: "order-1", p_payment_id: "tender-2" }),
    );
  });
});

describe("completed refund ingestion", () => {
  it("retrieves the order total before invoking the atomic refund RPC", async () => {
    const response = await post(refundEvent());

    expect(response.status).toBe(200);
    expect(orderGet).toHaveBeenCalledWith({ orderId: "order-1" });
    expect(rpc).toHaveBeenCalledWith("ingest_square_refund_atomic", {
      p_refund_id: "refund-1",
      p_event_id: "evt-refund-1",
      p_order_id: "order-1",
      p_payment_id: "payment-1",
      p_square_location_id: "square-location-1",
      p_refunded_at: expect.any(String),
      p_refund_amount: 900,
      p_order_total: 2400,
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("passes unknown refund sizing as null for durable manual reconciliation", async () => {
    orderGet.mockResolvedValue({ order: { totalMoney: {} } });
    const response = await post(refundEvent({ amount_money: undefined }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "ingest_square_refund_atomic",
      expect.objectContaining({ p_refund_amount: null, p_order_total: null }),
    );
  });

  it("returns refund-specific retry signaling", async () => {
    rpc.mockResolvedValue({
      data: { kind: "in_flight", retry_after_seconds: 7 },
      error: null,
    });
    const response = await post(refundEvent());
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("7");
    expect(await response.json()).toEqual({ error: "refund_claim_in_flight" });
  });

  it.each(["duplicate", "manual_reconcile"] as const)(
    "acknowledges a %s refund result",
    async (kind) => {
      rpc.mockResolvedValue({ data: { kind }, error: null });
      const response = await post(refundEvent());
      expect(response.status).toBe(200);
    },
  );

  // `ignored` used to share the group above with `duplicate`, which encoded the
  // assumption that "no sale here" and "no sale here YET" are equally terminal
  // (#607). The RPC no longer returns it — a missing sale is now sale_missing —
  // but a deployment whose function body predates 00277 still can, and that
  // legacy result must stay acknowledged rather than 503-looping.
  it("still acknowledges a legacy pre-00277 ignored refund result", async () => {
    rpc.mockResolvedValue({ data: { kind: "ignored" }, error: null });
    const response = await post(refundEvent());
    expect(response.status).toBe(200);
  });

  it("asks Square to redeliver a refund whose sale has not been ingested yet (#607)", async () => {
    rpc.mockResolvedValue({
      data: { kind: "sale_missing", retry_after_seconds: 900 },
      error: null,
    });
    const response = await post(refundEvent());
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("900");
    expect(await response.json()).toEqual({ error: "refund_sale_missing" });
  });

  it("acknowledges a sale-missing refund once it is past Square's redelivery horizon", async () => {
    rpc.mockResolvedValue({
      data: { kind: "sale_missing", retry_after_seconds: 900 },
      error: null,
    });
    const event = refundEvent();
    event.created_at = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
    const response = await post(event);
    expect(response.status).toBe(200);
    // The durable sale_missing log row written by the RPC is the operator's
    // reconciliation trace from here on; nothing is silently dropped.
    expect(rpc).not.toHaveBeenCalled();
  });

  it("ignores a pending or unidentified refund before any side effect", async () => {
    const pending = await post(refundEvent({ status: "PENDING" }));
    const unidentified = await post(refundEvent({ id: undefined }));
    expect(pending.status).toBe(200);
    expect(unidentified.status).toBe(200);
    expect(orderGet).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("replay windows and inventory events", () => {
  it("accepts payment retries older than five minutes but within Square's horizon", async () => {
    const event = paymentEvent();
    event.created_at = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const response = await post(event);
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("acknowledges and ignores payment retries beyond the 25-hour horizon", async () => {
    const event = paymentEvent();
    event.created_at = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
    const response = await post(event);
    expect(await response.json()).toEqual({ received: true, ignored: "stale_event" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("keeps non-payment events on the five-minute replay window", async () => {
    const event = {
      type: "inventory.count.updated",
      event_id: "inventory-old",
      created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      data: {},
    };
    const response = await post(event);
    expect(await response.json()).toEqual({ received: true, ignored: "stale_event" });
    expect(from).not.toHaveBeenCalled();
  });

  it("durably logs a fresh inventory event without invoking an ingestion RPC", async () => {
    const event = {
      type: "inventory.count.updated",
      event_id: "inventory-1",
      created_at: new Date().toISOString(),
      data: { object: { inventory_counts: [{ catalog_object_id: "variation-1" }] } },
    };
    const response = await post(event);
    expect(response.status).toBe(200);
    expect(from).toHaveBeenCalledWith("square_sync_log");
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        sync_type: "inventory_event",
        event_id: "inventory-1",
        completed_at: expect.any(String),
      }),
      { onConflict: "event_id", ignoreDuplicates: true },
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 500 when the informational inventory log fails", async () => {
    upsert.mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "write failed" },
    });
    const event = {
      type: "inventory.count.updated",
      event_id: "inventory-1",
      created_at: new Date().toISOString(),
      data: {},
    };
    const response = await post(event);
    expect(response.status).toBe(500);
  });
});
