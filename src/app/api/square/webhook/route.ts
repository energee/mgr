/**
 * Square webhook handler.
 *
 * Square calls this route without an MGR session, so the HMAC signature is the
 * authentication boundary. Completed payments and refunds are normalized from
 * Square's payload/API response, then handed to one service-role-only database
 * function. Each function owns its claim, ledger movement, physical bin change,
 * draft staging/voiding, and finalization in a single PostgreSQL transaction.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSquareClient, getSquareSettings } from "@/integrations/square/client";
import type { SquareSyncType } from "@/integrations/square/types";
import {
  checkReplayWindow,
  DEFAULT_REPLAY_WINDOW_MS,
  PAYMENT_REPLAY_WINDOW_MS,
  verifyWebhookSignature,
} from "@/integrations/square/webhook";
import { logger } from "@/lib/logger";
import { unwrap } from "@/lib/supabase/query-helpers";
import { createAdminClient } from "@/lib/supabase/server";
import { dynamicRpc } from "@/services/types";

const log = logger.child({ route: "/api/square/webhook" });

type SquareWebhookEvent = {
  merchant_id?: string;
  type: string;
  event_id?: string;
  created_at?: string;
  data?: {
    type?: string;
    id?: string;
    object?: {
      payment?: {
        id?: string;
        order_id?: string;
        location_id?: string;
        status?: string;
      };
      refund?: {
        id?: string;
        status?: string;
        payment_id?: string;
        order_id?: string;
        location_id?: string;
        amount_money?: { amount?: number | string };
      };
      [key: string]: unknown;
    };
  };
};

type OversoldLine = {
  lineItemUid: string;
  brandId: string;
  sellingFormatId: string;
  soldQty: number;
  binQuantityBefore: number;
  shortfallQty: number;
};

type AtomicIngestResult = {
  // `sale_missing` (#607): a COMPLETED refund whose sale_ingest claim does not
  // exist YET. The RPC records it durably and this route asks Square to
  // redeliver, so a sale that lands later still gets its reversal.
  // `ignored` is legacy — the pre-00277 refund function returned it for the
  // same situation and dropped the event; it is kept so a deployment running
  // an older function body is still acknowledged rather than 503-looped.
  kind:
    | "processed"
    | "duplicate"
    | "in_flight"
    | "manual_reconcile"
    | "sale_missing"
    | "ignored";
  retry_after_seconds?: number;
  oversold_lines?: OversoldLine[];
  items_synced?: number;
  items_failed?: number;
};

type PaymentIngestResult =
  | { kind: "processed"; oversoldLines: OversoldLine[] }
  | { kind: "in_flight"; retryAfterSeconds: number }
  | { kind: "sale_missing"; retryAfterSeconds: number };

function resolveNotificationUrl(): string {
  const explicit = process.env.SQUARE_WEBHOOK_URL;
  if (explicit) return explicit;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    throw new Error(
      "Square webhook URL not configured: set SQUARE_WEBHOOK_URL or NEXT_PUBLIC_APP_URL",
    );
  }
  return `${appUrl}/api/square/webhook`;
}

function handlerResult(
  result: AtomicIngestResult,
  context: { orderId: string; claimId?: string },
): PaymentIngestResult | undefined {
  if (result.kind === "in_flight") {
    return {
      kind: "in_flight",
      retryAfterSeconds: Math.max(1, result.retry_after_seconds ?? 1),
    };
  }
  if (result.kind === "sale_missing") {
    // Durable on the RPC side (a completed refund_ingest row flagged
    // state=sale_missing), retryable on this side. Never a bare 200 — that is
    // what permanently dropped the reversal before #607.
    log.warn(
      { order_id: context.orderId, claim_id: context.claimId },
      "Square refund arrived before its sale was ingested; recorded and asking Square to redeliver",
    );
    return {
      kind: "sale_missing",
      retryAfterSeconds: Math.max(1, result.retry_after_seconds ?? 900),
    };
  }
  if (result.kind === "manual_reconcile") {
    log.error(
      { order_id: context.orderId, claim_id: context.claimId },
      "Legacy incomplete Square claim has unknown side effects; marked for manual reconciliation",
    );
  }
  if (result.kind !== "processed") return;
  return { kind: "processed", oversoldLines: result.oversold_lines ?? [] };
}

function safeMoney(value: unknown): number | null {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("x-square-hmacsha256-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const settings = await getSquareSettings();
  if (!settings?.webhookSignatureKey) {
    return NextResponse.json(
      { error: "Webhook signature key not configured" },
      { status: 400 },
    );
  }

  let notificationUrl: string;
  try {
    notificationUrl = resolveNotificationUrl();
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : err },
      "Square webhook URL misconfigured; rejecting webhook",
    );
    return NextResponse.json({ error: "Webhook URL not configured" }, { status: 500 });
  }

  if (!verifyWebhookSignature(body, signature, settings.webhookSignatureKey, notificationUrl)) {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "unknown";
    log.warn({ ip }, "Invalid Square webhook signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: SquareWebhookEvent;
  try {
    event = JSON.parse(body) as SquareWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const replayWindowMs =
    event.type.startsWith("payment.") || event.type.startsWith("refund.")
      ? PAYMENT_REPLAY_WINDOW_MS
      : DEFAULT_REPLAY_WINDOW_MS;
  const replay = checkReplayWindow(event.created_at, replayWindowMs);
  if (!replay.ok) {
    log.warn(
      { event_id: event.event_id, created_at: event.created_at, reason: replay.reason },
      "Acknowledged but ignored replay-check failure",
    );
    return NextResponse.json({ received: true, ignored: replay.reason });
  }

  let oversoldLines: OversoldLine[] = [];
  try {
    switch (event.type) {
      case "payment.created":
      case "payment.updated": {
        const result = await handleCompletedPayment(event);
        if (result?.kind === "in_flight") {
          return NextResponse.json(
            { error: "sale_claim_in_flight" },
            {
              status: 503,
              headers: { "Retry-After": String(result.retryAfterSeconds) },
            },
          );
        }
        oversoldLines = result?.kind === "processed" ? result.oversoldLines : [];
        break;
      }
      case "refund.created":
      case "refund.updated": {
        const result = await handleCompletedRefund(event);
        if (result?.kind === "in_flight" || result?.kind === "sale_missing") {
          // 503 + Retry-After keeps the event on Square's redelivery schedule.
          // The horizon is bounded by the replay-window check above: once the
          // event is older than PAYMENT_REPLAY_WINDOW_MS it is acknowledged
          // 200 instead of looping, and the RPC's durable sale_missing log row
          // is the operator's reconciliation trace from then on (#607).
          return NextResponse.json(
            {
              error:
                result.kind === "in_flight"
                  ? "refund_claim_in_flight"
                  : "refund_sale_missing",
            },
            {
              status: 503,
              headers: { "Retry-After": String(result.retryAfterSeconds) },
            },
          );
        }
        break;
      }
      case "inventory.count.updated":
        await handleInventoryCountUpdated(event);
        break;
      default:
        break;
    }
  } catch (err) {
    log.error(
      {
        err: err instanceof Error ? err.message : err,
        event_id: event.event_id,
        type: event.type,
      },
      `Error processing ${event.type}; Square will retry`,
    );
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }

  return NextResponse.json(
    oversoldLines.length > 0
      ? { received: true, oversoldLines }
      : { received: true },
  );
}

async function handleCompletedPayment(
  event: SquareWebhookEvent,
): Promise<PaymentIngestResult | undefined> {
  const payment = event.data?.object?.payment;
  if (!payment) {
    log.warn("payment event missing payment object");
    return;
  }
  if (payment.status !== "COMPLETED") {
    log.info(
      { payment_id: payment.id, status: payment.status, type: event.type },
      "Payment not COMPLETED; acknowledged and ignored",
    );
    return;
  }
  if (!payment.order_id) {
    log.warn(
      { payment_id: payment.id, event_id: event.event_id },
      "COMPLETED payment missing order_id; acknowledged and ignored",
    );
    return;
  }

  // Square network I/O happens before the database transaction begins. Once
  // the RPC starts, it performs every durable side effect or rolls all of them
  // back, including the dedup claim.
  const client = await getSquareClient();
  if (!client) throw new Error("Square client not available");
  const orderResponse = await client.orders.get({ orderId: payment.order_id });
  const lines = (orderResponse.order?.lineItems ?? []).map((line) => ({
    uid: line.uid ?? null,
    catalog_object_id: line.catalogObjectId ?? null,
    quantity: line.quantity,
    unit_price_cents: safeMoney(line.basePriceMoney?.amount) ?? 0,
  }));

  const admin = await createAdminClient();
  const result = await unwrap<AtomicIngestResult>(
    dynamicRpc(admin, "ingest_square_sale_atomic", {
      p_claim_key: payment.order_id,
      p_event_id: event.event_id ?? null,
      p_order_id: payment.order_id,
      p_payment_id: payment.id ?? null,
      p_square_location_id: payment.location_id ?? null,
      p_sold_at: event.created_at ?? new Date().toISOString(),
      p_lines: lines,
    }),
  );
  return handlerResult(result, {
    orderId: payment.order_id,
    claimId: payment.order_id,
  });
}

async function handleCompletedRefund(
  event: SquareWebhookEvent,
): Promise<PaymentIngestResult | undefined> {
  const refund = event.data?.object?.refund;
  if (!refund) {
    log.warn("refund event missing refund object");
    return;
  }
  if (refund.status !== "COMPLETED") {
    log.info(
      { refund_id: refund.id, status: refund.status, type: event.type },
      "Refund not COMPLETED; acknowledged and ignored",
    );
    return;
  }
  if (!refund.id || !refund.order_id) {
    log.warn(
      { refund_id: refund.id, order_id: refund.order_id, event_id: event.event_id },
      "COMPLETED refund missing refund or order id; acknowledged and ignored",
    );
    return;
  }

  const client = await getSquareClient();
  if (!client) throw new Error("Square client not available");
  const orderResponse = await client.orders.get({ orderId: refund.order_id });

  const admin = await createAdminClient();
  const result = await unwrap<AtomicIngestResult>(
    dynamicRpc(admin, "ingest_square_refund_atomic", {
      p_refund_id: refund.id,
      p_event_id: event.event_id ?? null,
      p_order_id: refund.order_id,
      p_payment_id: refund.payment_id ?? null,
      p_square_location_id: refund.location_id ?? null,
      p_refunded_at: event.created_at ?? new Date().toISOString(),
      p_refund_amount: safeMoney(refund.amount_money?.amount),
      p_order_total: safeMoney(orderResponse.order?.totalMoney?.amount),
    }),
  );
  return handlerResult(result, { orderId: refund.order_id, claimId: refund.id });
}

async function handleInventoryCountUpdated(event: SquareWebhookEvent) {
  if (!event.event_id) {
    log.warn("inventory.count.updated event missing event_id; not logging");
    return;
  }

  const admin = await createAdminClient();
  const { error } = await admin.from("square_sync_log").upsert(
    {
      sync_type: "inventory_event" satisfies SquareSyncType,
      event_id: event.event_id,
      items_synced: 0,
      items_failed: 0,
      details: {
        event_type: "inventory.count.updated",
        note: "Logged for informational purposes only. MGR is source of truth for inventory.",
        raw_data: (event.data ?? null) as import("@/types/supabase").Json,
      },
      completed_at: new Date().toISOString(),
    },
    { onConflict: "event_id", ignoreDuplicates: true },
  );
  if (error) throw error;
}
