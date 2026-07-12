/**
 * Square Webhook Handler
 *
 * POST: Receives and processes Square webhook events.
 *
 * This route does NOT use withAuth since it is called by Square's servers,
 * not authenticated users. Authentication is handled via HMAC signature
 * verification using the webhook_signature_key stored in square_settings.
 *
 * Supported event types:
 *   - payment.created / payment.updated: Square does NOT emit a
 *     "payment.completed" event — a payment's lifecycle is surfaced through
 *     created/updated deliveries whose `status` field transitions to
 *     "COMPLETED". Both are routed to handleCompletedPayment, which only
 *     ingests the sale once the payment status is "COMPLETED" (other statuses
 *     are acknowledged and ignored). Dedup keys on the Square *order id*
 *     (falling back to the payment id only when order_id is absent): a single
 *     sale can arrive as BOTH a created and an updated delivery already
 *     COMPLETED, and a check split across tenders arrives as MULTIPLE
 *     payments — each of which references the SAME order whose full line-item
 *     list we ingest. Claiming per payment would debit the bins once per
 *     tender; claiming per order debits exactly once. A claim that never
 *     completed (crash/timeout mid-processing) is treated as stale after
 *     STALE_CLAIM_MS and atomically taken over by a retry, so a stranded
 *     claim cannot permanently dedup-skip the sale. Until the claim is stale
 *     enough to take over, a retry hitting an UNFINISHED claim gets 503 (with
 *     Retry-After) — never 200, which would make Square mark the event
 *     delivered while the sale may never have been ingested (audit IN-1).
 *     Because the order-keyed claim makes payment ingestion exactly-once,
 *     payment.* events accept a replay window covering Square's full 24h
 *     retry horizon (PAYMENT_REPLAY_WINDOW_MS, audit IN-2); all other event
 *     types keep the tight ±5-min window.
 *     Packaged lines resolve the Square location to a POS bin and
 *     draw the sold quantity FIFO across every finished-good lot physically in
 *     that bin (oldest production_date first), recording one taproom_sale
 *     allocation (with volume_bbl for TTB removals) and one debit_bin_inventory
 *     call per lot drawn. If the bin cannot cover the sale — either the planned
 *     FIFO draw falls short, or a concurrent sale won the row lock and the RPC
 *     clamped a debit at zero — only the stock that physically existed is
 *     debited and the oversell is surfaced in the response + sync log. Draft
 *     (keg) pours are staged in square_draft_sales (keg depletion is deferred).
 *   - refund.created / refund.updated: Reverse an ingested sale (audit IN-3).
 *     Only COMPLETED refunds whose order this system ingested (a COMPLETED
 *     sale_ingest claim exists for the order id) are processed — anything else
 *     is 200-acknowledged and ignored (not an MGR sale, or pre-integration).
 *     Dedup mirrors the sale claim discipline but keys on the Square REFUND id
 *     (the order id slot in the UNIQUE square_payment_id column is held by the
 *     sale claim, and one order can be partially refunded several times).
 *     Because 00211 blocks deleting completed allocations and 00205's state
 *     machine makes 'completed' terminal (no status-cancel), the reversal is
 *     the mechanism 00211 prescribes: an INVERSE adjustment allocation
 *     (destination_type 'adjustment', reason_code 'refund', negative quantity
 *     and volume_bbl — permitted for adjustment rows by 00241) per original
 *     lot draw, plus a row-locked credit_bin_inventory credit (00241). The
 *     negative volume nets TTB total removals in the REFUND month via
 *     adjustments_bbl (never rewriting a filed sale month) and the negative
 *     quantity restores ledger availability so the credited bin units are
 *     POS-sellable again. Partial refunds reverse proportionally by amount
 *     (floored per lot draw, so repeated partials can never over-reverse) and
 *     are flagged in square_sync_log.details. Un-reconciled draft (keg) rows
 *     are stamped voided_at on a FULL refund; partial refunds leave drafts for
 *     manual review (flagged in details).
 *   - inventory.count.updated: Logged for informational purposes only (MGR is
 *     the source of truth for inventory).
 *   - All other events: Acknowledged with 200 but ignored.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getSquareClient, getSquareSettings } from "@/integrations/square/client";
import {
  checkReplayWindow,
  DEFAULT_REPLAY_WINDOW_MS,
  PAYMENT_REPLAY_WINDOW_MS,
  verifyWebhookSignature,
} from "@/integrations/square/webhook";
import { calculateVolumeOz } from "@/integrations/square/utils";
import { computeUnitFillVolumeBbl } from "@/domain/consumption-planning";
import type { SquareSyncType } from "@/integrations/square/types";
import { dynamicFrom } from "@/services/types";
import { logger } from "@/lib/logger";

const log = logger.child({ route: "/api/square/webhook" });

/**
 * How old an UNFINISHED dedup claim (completed_at IS NULL) must be before a
 * retry may take it over. Claims normally finish (completed_at set) or are
 * deleted on failure within seconds; only a crash/timeout mid-processing
 * strands one. 15 minutes comfortably exceeds any serverless function timeout,
 * so a live in-flight handler can never be raced by its own retry. Retries
 * that arrive while the claim is unfinished but NOT yet stale get 503 (audit
 * IN-1) so Square keeps retrying until takeover becomes possible.
 */
const STALE_CLAIM_MS = 15 * 60 * 1000;

/**
 * Render a thrown value as a human-readable message for the per-line error log.
 * supabase-js rejects with plain PostgrestError objects (not Error instances),
 * so a bare `String(err)` would flatten them to "[object Object]" and swallow
 * the DB message — this keeps per-line failures loud in square_sync_log.
 */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (
    err !== null &&
    typeof err === "object" &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }
  return String(err);
}

/**
 * Resolve the notification URL Square signs against. Either SQUARE_WEBHOOK_URL
 * or NEXT_PUBLIC_APP_URL must be set — otherwise the URL would silently
 * stringify to `"undefined/api/square/webhook"` and every signature would
 * fail in confusing ways (audit PR #273 nit).
 */
function resolveNotificationUrl(): string {
  const explicit = process.env.SQUARE_WEBHOOK_URL;
  if (explicit) return explicit;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    throw new Error(
      "Square webhook URL not configured: set SQUARE_WEBHOOK_URL or NEXT_PUBLIC_APP_URL"
    );
  }
  return `${appUrl}/api/square/webhook`;
}

// Square webhook event shape (subset of fields we care about)
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
        // Square delivers payment.created/updated as the payment moves through
        // its lifecycle; we only ingest the sale once this reads "COMPLETED".
        status?: string;
      };
      // refund.created / refund.updated (PaymentRefund). Like payments, a
      // refund's lifecycle is delivered via created/updated whose status
      // transitions to "COMPLETED" — only then is the reversal applied. The
      // refund object carries NO line-item detail (itemized returns live on a
      // separate Square return order), so partial refunds reverse
      // proportionally by amount_money against the order total.
      refund?: {
        id?: string;
        status?: string;
        payment_id?: string;
        order_id?: string;
        location_id?: string;
        amount_money?: { amount?: number | string };
      };
      // inventory.count.updated nests differently
      [key: string]: unknown;
    };
  };
}

/**
 * A packaged sale line whose sold quantity exceeded the physical stock in its
 * resolved POS bin (D3 oversell). Two triggers:
 *
 * 1. The FIFO draw consumed every matching lot in the bin and still could not
 *    cover the sale (planned shortfall — shortfallQty > 0).
 * 2. debit_bin_inventory returned clamped = true: a concurrent sale drained the
 *    bin between our unlocked bin_inventory read and the row-locked debit, so
 *    the DB clamped the debit at zero (clamped race — shortfallQty may be 0,
 *    because the plan looked fully covered; the true shortfall is unknowable
 *    from (new_quantity, clamped) alone, so we never invent a number).
 *
 * Either way only the stock that physically existed was debited (we never
 * invent an allocation for a planned shortfall). The sale still counts as
 * synced. Surfaced in the webhook response and durably in
 * square_sync_log.details so the POS/caller can reconcile.
 *
 * - binQuantityBefore: SUM of the bin's quantities across every matched lot
 *   before the debit (what the bin actually held for this brand + format).
 * - shortfallQty: sold quantity that no lot could cover per the FIFO plan
 *   (soldQty − binQuantityBefore, clamped at 0). 0 on a pure clamped race.
 * - clamped: present (true) when trigger 2 fired — at least one debit for this
 *   line was clamped at zero by the DB.
 */
type OversoldLine = {
  lineItemUid: string;
  brandId: string;
  sellingFormatId: string;
  soldQty: number;
  binQuantityBefore: number;
  shortfallQty: number;
  clamped?: boolean;
};

/**
 * Outcome of handleCompletedPayment. `undefined` means acknowledged-and-ignored
 * (non-COMPLETED status, missing ids, duplicate of a COMPLETED claim, …) — POST
 * answers 200 so Square stops delivering.
 *
 * - processed: the sale was ingested (this delivery, or a stale-claim
 *   takeover); oversoldLines carries any D3 oversells for the response.
 * - in_flight: the order is claimed by an UNFINISHED, not-yet-stale claim
 *   (audit IN-1). POST answers 503 so Square keeps retrying until the claim
 *   either completes (→ duplicate, 200) or goes stale (→ takeover).
 *   retryAfterSeconds hints when the claim becomes stale enough to take over.
 */
type PaymentIngestResult =
  | { kind: "processed"; oversoldLines: OversoldLine[] }
  | { kind: "in_flight"; retryAfterSeconds: number };

export async function POST(request: NextRequest) {
  // 1. Read raw body as text (needed for signature verification)
  const body = await request.text();

  // 2. Get signature header
  const signature = request.headers.get("x-square-hmacsha256-signature");
  if (!signature) {
    return NextResponse.json(
      { error: "Missing signature" },
      { status: 400 }
    );
  }

  // 3. Get Square settings (admin client bypasses RLS to read signature key)
  const settings = await getSquareSettings();
  if (!settings?.webhookSignatureKey) {
    return NextResponse.json(
      { error: "Webhook signature key not configured" },
      { status: 400 }
    );
  }

  // 4. Determine notification URL
  let notificationUrl: string;
  try {
    notificationUrl = resolveNotificationUrl();
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : err },
      "Square webhook URL misconfigured; rejecting webhook"
    );
    return NextResponse.json(
      { error: "Webhook URL not configured" },
      { status: 500 }
    );
  }

  // 5. Verify signature
  const isValid = verifyWebhookSignature(
    body,
    signature,
    settings.webhookSignatureKey,
    notificationUrl
  );

  if (!isValid) {
    // Log so a stream of bad signatures is observable (audit PR #273 B-3).
    // Use the forwarded-for chain if present (Vercel/most proxies), otherwise
    // request.ip is `unknown` and we just record the absence.
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "unknown";
    log.warn({ ip }, "Invalid Square webhook signature");
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: 401 }
    );
  }

  // 6. Parse body as JSON
  let event: SquareWebhookEvent;
  try {
    event = JSON.parse(body) as SquareWebhookEvent;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  // Replay protection (audit F-127). Rejections return 200 (not 4xx): Square
  // retries any non-2xx on exponential backoff for up to 24h, and a stale
  // event is stale on every retry — 4xx here would create a retry storm.
  //
  // The window is per event type (audit IN-2): payment.* ingestion is
  // exactly-once regardless of delivery age — the order-keyed dedup claim
  // (UNIQUE uniq_square_sync_log_square_payment_id, 00224/00233) rejects
  // re-ingestion — so payment events accept Square's full 24h retry horizon.
  // Under the tight ±5-min window, any outage longer than 5 minutes
  // permanently dropped every sale delivered during it: Square retried for a
  // day, but each retry was "stale" and 200-acknowledged. refund.* gets the
  // same wide window for the same reason: refund ingestion is exactly-once
  // via its refund-id claim in the same UNIQUE column (audit IN-3). Event
  // types without that unconditional dedup guarantee (inventory.count.updated
  // dedups only when event_id is present) keep the tight window.
  const replayWindowMs =
    event.type.startsWith("payment.") || event.type.startsWith("refund.")
      ? PAYMENT_REPLAY_WINDOW_MS
      : DEFAULT_REPLAY_WINDOW_MS;
  const replay = checkReplayWindow(event.created_at, replayWindowMs);
  if (!replay.ok) {
    log.warn(
      { event_id: event.event_id, created_at: event.created_at, reason: replay.reason },
      "Acknowledged but ignored replay-check failure"
    );
    return NextResponse.json({ received: true, ignored: replay.reason });
  }

  let oversoldLines: OversoldLine[] = [];
  try {
    switch (event.type) {
      // Square emits payment.created and payment.updated (never
      // "payment.completed"); both may already carry status COMPLETED, so both
      // route to the same handler, which dedups on the payment id.
      case "payment.created":
      case "payment.updated": {
        const result = await handleCompletedPayment(event);
        // IN-1: an unfinished-but-fresh dedup claim means the sale may still be
        // processing — or its handler crashed too recently for the stale-claim
        // takeover. A 200 here would make Square mark the event delivered,
        // permanently losing the sale if the owner crashed. 503 keeps Square's
        // retry stream alive (exponential backoff, up to 24h) until the claim
        // completes (→ 200 duplicate) or goes stale (→ takeover re-processes).
        if (result?.kind === "in_flight") {
          return NextResponse.json(
            { error: "sale_claim_in_flight" },
            {
              status: 503,
              headers: { "Retry-After": String(result.retryAfterSeconds) },
            }
          );
        }
        oversoldLines = result?.oversoldLines ?? [];
        break;
      }

      // Square emits refund.created and refund.updated as a refund moves
      // PENDING → COMPLETED (mirror of the payment lifecycle above); both
      // route to the same handler, which only reverses once COMPLETED and
      // dedups on the refund id (audit IN-3).
      case "refund.created":
      case "refund.updated": {
        const result = await handleCompletedRefund(event);
        // Same IN-1 discipline as the payment arm: an unfinished-but-fresh
        // claim (the refund's own, or its sale's still-running ingestion) must
        // 503 so Square keeps retrying — a 200 would mark the refund delivered
        // while the reversal may never have been applied.
        if (result?.kind === "in_flight") {
          return NextResponse.json(
            { error: "refund_claim_in_flight" },
            {
              status: 503,
              headers: { "Retry-After": String(result.retryAfterSeconds) },
            }
          );
        }
        break;
      }

      case "inventory.count.updated":
        await handleInventoryCountUpdated(event);
        break;

      default:
        // Acknowledge but ignore unknown event types
        break;
    }
  } catch (err) {
    // Return 500 so Square retries delivery; the UNIQUE constraint on
    // square_payment_id guarantees only one retry can actually re-process.
    log.error(
      { err: err instanceof Error ? err.message : err, event_id: event.event_id, type: event.type },
      `Error processing ${event.type}; Square will retry`
    );
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }

  // D3: the sale succeeded, but one or more packaged lines sold more units than
  // the resolved bin physically held — either the FIFO plan fell short
  // (shortfallQty > 0) or a concurrent sale forced the DB to clamp a debit at
  // zero (clamped: true, shortfallQty may be 0). Only the stock that existed
  // was debited; the oversell is surfaced so the caller can reconcile (also
  // recorded in square_sync_log.details).
  return NextResponse.json(
    oversoldLines.length > 0
      ? { received: true, oversoldLines }
      : { received: true }
  );
}

// ---------------------------------------------------------------------------
// Shared ingest-claim discipline (sale + refund)
// ---------------------------------------------------------------------------

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>;

/**
 * Outcome of claimIngestSlot:
 * - claimed: this delivery owns the work; logId is the fresh sync-log row.
 * - taken_over: the previous owner crashed mid-flight (unfinished claim older
 *   than STALE_CLAIM_MS) and this delivery atomically re-stamped it; logId is
 *   the reclaimed row. Re-processing after a partial crash is at-least-once by
 *   design — the alternative (hold the claim forever) silently loses the work,
 *   which is worse. The sync-log row survives for reconciliation either way.
 * - duplicate: the claim COMPLETED — a genuine duplicate delivery (created +
 *   updated of one payment/refund, or a second tender of a split check).
 *   Callers ACK 200 so Square stops delivering.
 * - in_flight: the claim is UNFINISHED but fresh — its owner may still be
 *   running, or crashed too recently for takeover (audit IN-1). Callers signal
 *   503 (retryAfterSeconds hints when the claim becomes stale enough to take
 *   over) so Square keeps retrying until the claim resolves into duplicate or
 *   taken_over — never 200, which would make Square mark the event delivered
 *   while the work may never have happened.
 */
type ClaimOutcome =
  | { kind: "claimed"; logId: string }
  | { kind: "taken_over"; logId: string }
  | { kind: "duplicate" }
  | { kind: "in_flight"; retryAfterSeconds: number };

/**
 * Race-safe, exactly-once dedup claim on square_sync_log (audit F-135/IN-1),
 * shared by the sale and refund ingestion paths. The claim key lives in the
 * UNIQUE square_payment_id column (00224; 00233 documents that it stores each
 * path's claim key, not necessarily a payment id — the sale path claims the
 * ORDER id, the refund path the REFUND id): upsert with ON CONFLICT DO NOTHING
 * (ignoreDuplicates) returns [] on duplicate, so concurrent retries cannot
 * both proceed. Every DB error here THROWS (→ outer 500 → Square retries): a
 * transient error must never be mistaken for a duplicate, which would silently
 * drop the work under a 200 — only a genuine empty array is a duplicate. Never
 * deletes an existing row: a claim belongs to its owner (only the OWNING
 * attempt's failure path frees it).
 */
async function claimIngestSlot(
  admin: AdminClient,
  params: { syncType: SquareSyncType; claimKey: string; eventId: string | null }
): Promise<ClaimOutcome> {
  const { data: claimed, error: claimError } = await admin
    .from("square_sync_log")
    .upsert(
      {
        sync_type: params.syncType,
        event_id: params.eventId,
        square_payment_id: params.claimKey,
        items_synced: 0,
        items_failed: 0,
      },
      { onConflict: "square_payment_id", ignoreDuplicates: true }
    )
    .select("id");
  if (claimError) throw claimError;
  if (claimed && claimed.length > 0) {
    return { kind: "claimed", logId: claimed[0].id };
  }

  // Already claimed: attempt the atomic stale-claim takeover. The conditional
  // UPDATE re-stamps started_at only if the claim is still unfinished AND
  // stale, so exactly one of several concurrent retries wins (the others match
  // zero rows).
  const staleCutoff = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  const { data: takeover, error: takeoverError } = await admin
    .from("square_sync_log")
    .update({ started_at: new Date().toISOString() })
    .eq("square_payment_id", params.claimKey)
    .is("completed_at", null)
    .lt("started_at", staleCutoff)
    .select("id");
  if (takeoverError) throw takeoverError;
  if (takeover && takeover.length > 0) {
    return { kind: "taken_over", logId: takeover[0].id };
  }

  // Not stale: read the claim to tell a completed duplicate from an in-flight
  // owner. A read error throws → 500 → Square retries, same policy as every
  // other read here.
  const { data: claimRow, error: claimReadError } = await admin
    .from("square_sync_log")
    .select("completed_at, started_at")
    .eq("square_payment_id", params.claimKey)
    .maybeSingle();
  if (claimReadError) throw claimReadError;

  if (claimRow?.completed_at != null) {
    return { kind: "duplicate" };
  }

  // In flight — or the row vanished between the upsert and this read (the
  // owner's failure path freed it), in which case the next retry re-claims
  // immediately. Hint Square when the claim becomes stale enough to take over.
  const startedAtMs = claimRow?.started_at ? Date.parse(claimRow.started_at) : NaN;
  const retryAfterSeconds = Number.isFinite(startedAtMs)
    ? Math.max(1, Math.ceil((startedAtMs + STALE_CLAIM_MS - Date.now()) / 1000))
    : 1;
  return { kind: "in_flight", retryAfterSeconds };
}

// ---------------------------------------------------------------------------
// payment.created / payment.updated handler
// ---------------------------------------------------------------------------

async function handleCompletedPayment(
  event: SquareWebhookEvent
): Promise<PaymentIngestResult | undefined> {
  const payment = event.data?.object?.payment;
  if (!payment) {
    log.warn("payment event missing payment object");
    return;
  }

  // Square delivers payment.created/updated as the payment moves through its
  // lifecycle. Only ingest once it is COMPLETED; acknowledge (and ignore)
  // every other status so Square does not retry.
  if (payment.status !== "COMPLETED") {
    log.info(
      { payment_id: payment.id, status: payment.status, type: event.type },
      "Payment not COMPLETED; acknowledged and ignored"
    );
    return;
  }

  const orderId = payment.order_id;
  const paymentId = payment.id;
  const squareLocationId = payment.location_id;

  const admin = await createAdminClient();

  // Race-safe dedup (audit F-135): claim on the Square ORDER id before any
  // side effects. Keying on order id (not payment id, not event id) is
  // essential because the handler ingests the ORDER's full line-item list:
  //   - one payment arrives as BOTH payment.created and payment.updated
  //     (both can be COMPLETED) — two event_ids, one sale;
  //   - a check SPLIT ACROSS TENDERS arrives as multiple payments — several
  //     payment ids, one order. A payment-id claim would fetch and debit the
  //     same order's lines once per tender (double-debit + double TTB count).
  // The payment id is the fallback only when order_id is absent (in which case
  // there are no line items to double-ingest anyway). The claim column is
  // still named square_payment_id (00224); 00233 documents that it now stores
  // this order-first claim key and re-keys historical sale rows to order ids.
  // Claim mechanics (upsert / stale takeover / in-flight 503) live in
  // claimIngestSlot, shared with the refund path.
  const claimKey = orderId ?? paymentId;
  if (!claimKey) {
    log.warn(
      { event_id: event.event_id },
      "Payment event has neither order_id nor payment id; cannot dedup, ignoring"
    );
    return;
  }

  const claim = await claimIngestSlot(admin, {
    syncType: "sale_ingest",
    claimKey,
    eventId: event.event_id ?? null,
  });
  if (claim.kind === "duplicate") {
    log.info(
      { payment_id: paymentId, order_id: orderId },
      "Duplicate sale (order already ingested), skipping"
    );
    return;
  }
  if (claim.kind === "in_flight") {
    log.warn(
      { payment_id: paymentId, order_id: orderId, retryAfterSeconds: claim.retryAfterSeconds },
      "Sale claim in flight (unfinished, not yet stale); 503 so Square retries"
    );
    return { kind: "in_flight", retryAfterSeconds: claim.retryAfterSeconds };
  }
  if (claim.kind === "taken_over") {
    // NOTE: re-processing after a partial crash can re-debit lines the crashed
    // attempt already debited — at-least-once by design (see ClaimOutcome).
    log.warn(
      { payment_id: paymentId, order_id: orderId, log_id: claim.logId },
      "Took over stale in-flight sale claim; re-processing"
    );
  }
  const logId = claim.logId;

  // A COMPLETED payment should always carry an order_id; without one we cannot
  // fetch line items. Retrying THIS delivery is useless (same payload), so ACK
  // with 200 — but free the claim rather than hold it: the claim key here is
  // the payment id, and a sibling delivery for the same payment might carry
  // the order_id. Holding a dead zero-item claim row would only pollute the
  // sync log.
  if (!orderId) {
    log.warn({ payment_id: paymentId }, "COMPLETED payment missing order_id");
    const { error: freeError } = await admin
      .from("square_sync_log")
      .delete()
      .eq("id", logId);
    if (freeError) {
      log.error(
        { err: freeError.message, log_id: logId },
        "Failed to free claim for order-less payment"
      );
    }
    return;
  }

  try {
    const client = await getSquareClient();
    if (!client) {
      // Throw so the catch below frees the claim and the outer handler returns
      // 500; otherwise the claim sticks forever and retries dedup-skip.
      throw new Error("Square client not available");
    }

    const orderResponse = await client.orders.get({ orderId });
    const order = orderResponse.order;

    if (!order?.lineItems?.length) {
      log.info({ order_id: orderId }, "Order has no line items, skipping");
      await admin
        .from("square_sync_log")
        .update({
          details: {
            order_id: orderId,
            payment_id: paymentId,
            square_location_id: squareLocationId,
            note: "Order had no line items",
          },
          completed_at: new Date().toISOString(),
        })
        .eq("id", logId);
      return;
    }

    // Resolve the POS bin from the Square location ID (D1). Bins are the POS
    // targets in the bin-sync model: a Square location maps to at most one bin
    // (partial-unique index bins_unique_square_location). Packaged lines debit
    // this bin's finished-good stock; draft lines derive their MGR location from
    // it. Unmapped Square locations flag their lines below rather than guessing.
    let resolvedBin: {
      id: string;
      location_id: string;
      pos_sales_channel_id: string | null;
    } | null = null;
    if (squareLocationId) {
      const { data: bin, error: binLookupError } = await admin
        .from("bins")
        .select("id, location_id, pos_sales_channel_id")
        .eq("square_location_id", squareLocationId)
        .maybeSingle();
      // A transient read failure is NOT "location not mapped": flagging the
      // lines as unmapped returns 200, Square never retries, and the sale is
      // permanently lost. Throw so the catch below frees the claim and the
      // outer handler 500s — Square retries and the lookup gets another shot.
      if (binLookupError) throw binLookupError;
      resolvedBin = bin ?? null;
    }
    // MGR location used for draft staging (below) and the sync-log row. Derived
    // once from the resolved bin so both the packaged and draft branches agree.
    const locationId: string | null = resolvedBin?.location_id ?? null;

    let itemsSynced = 0;
    let itemsFailed = 0;
    const errors: Array<{ lineItemUid: string; error: string }> = [];
    // Non-fatal notes (e.g. a container missing volume_oz so volume_bbl could
    // not be computed) — the line still syncs, but we record why for TTB audit.
    const warnings: string[] = [];
    const oversoldLines: OversoldLine[] = [];

    for (const lineItem of order.lineItems) {
      const catalogObjectId = lineItem.catalogObjectId;
      if (!catalogObjectId) {
        // Non-catalog line item (custom amount), skip
        continue;
      }

      try {
        // Look up the catalog mapping with the selling format's container type
        // AND the volume fields needed to stamp allocation.volume_bbl (so TTB
        // taxpaid-removals report the sale — get_ttb_removals_summary, 00203).
        const { data: mapping, error: mappingError } = await dynamicFrom(admin, "square_catalog_map")
          .select(
            "id, brand_id, selling_format_id, selling_formats(unit_count, containers(type, volume_oz))"
          )
          .eq("square_catalog_id", catalogObjectId)
          .eq("object_type", "ITEM_VARIATION")
          .maybeSingle();
        // A transient read failure is NOT "not an MGR product" (audit SF-1):
        // treating it as unmapped silently skips the sale line under a 200 and
        // Square never retries. Throw so the per-line catch records the line
        // as FAILED in square_sync_log — same handling as binError /
        // allocError / debitError.
        if (mappingError) throw mappingError;

        if (!mapping) {
          // No mapping found — could be a non-MGR product sold on Square
          continue;
        }

        // Square sends quantity as a decimal string (up to 5 decimal places).
        // parseInt would silently truncate "2.5" to 2 and mis-debit; parse with
        // Number and only accept positive whole numbers — MGR sells packaged
        // units and pours in integers, so anything else is flagged, not guessed.
        const quantity = Number(lineItem.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) continue;
        if (!Number.isInteger(quantity)) {
          itemsFailed++;
          errors.push({
            lineItemUid: lineItem.uid ?? "unknown",
            error: `Non-integer quantity "${lineItem.quantity}" — cannot debit fractional units`,
          });
          continue;
        }

        // Determine if this is a keg (draft) or packaged good based on container type.
        // The join may be null if the selling format or container was deleted.
        const containerType = mapping.selling_formats?.containers?.type ?? null;
        const isDraft = containerType === "keg";

        if (!containerType) {
          itemsFailed++;
          errors.push({
            lineItemUid: lineItem.uid ?? "unknown",
            error: `Catalog mapping ${mapping.id} has no linked container type (selling_format or container may have been deleted)`,
          });
          continue;
        }

        if (!isDraft) {
          // ---------------------------------------------------------------
          // Packaged good sale: draw the sold quantity FIFO across the bin's
          // finished-good lots (D2), recording one taproom_sale allocation
          // (with volume_bbl for TTB) + one debit_bin_inventory per lot.
          // ---------------------------------------------------------------

          // A packaged sale must land in a mapped POS bin; without one we cannot
          // know which physical stock to debit, so flag the line (D1).
          if (!resolvedBin) {
            itemsFailed++;
            errors.push({
              lineItemUid: lineItem.uid ?? "unknown",
              error: `Square location ${squareLocationId} is not mapped to a POS bin`,
            });
            continue;
          }

          // ALL matching lots physically in THIS bin for the sold brand +
          // selling format. bin_inventory is UNIQUE(finished_good_id, bin_id),
          // so one bin legitimately holds several lots (production dates) of the
          // same brand+format — we must draw across them, not dump the whole
          // sold quantity on one arbitrary lot. dynamicFrom is used because the
          // strongly-typed builder rejects the embedded-resource filters
          // (finished_goods.brand_id). NOTE: PostgREST cannot order by an
          // embedded to-one column here (`referencedTable` orders the embed, a
          // no-op for the parent row order), so we fetch unordered and sort the
          // FIFO in JS below.
          const { data: binRows, error: binError } = await dynamicFrom(admin, "bin_inventory")
            .select(
              "finished_good_id, quantity, finished_goods!inner(production_date, brand_id, selling_format_id)"
            )
            .eq("bin_id", resolvedBin.id)
            .eq("finished_goods.brand_id", mapping.brand_id)
            .eq("finished_goods.selling_format_id", mapping.selling_format_id)
            .gt("quantity", 0);
          if (binError) throw binError;

          type BinLot = {
            finished_good_id: string;
            quantity: number;
            finished_goods: { production_date: string | null } | null;
          };
          const lots: BinLot[] = (binRows ?? []) as BinLot[];

          if (lots.length === 0) {
            itemsFailed++;
            errors.push({
              lineItemUid: lineItem.uid ?? "unknown",
              error: `No finished good with available inventory in bin ${resolvedBin.id} for brand ${mapping.brand_id} / selling format ${mapping.selling_format_id}`,
            });
            continue;
          }

          // Real FIFO: oldest production_date first, undated lots (null) last.
          const prodTime = (l: BinLot) => {
            const d = l.finished_goods?.production_date;
            return d ? new Date(d).getTime() : Number.POSITIVE_INFINITY;
          };
          const sortedLots = [...lots].sort((a, b) => prodTime(a) - prodTime(b));
          const binQuantityBefore = sortedLots.reduce((sum, l) => sum + l.quantity, 0);

          // Per-selling-unit fill volume (bbl) for the TTB allocation. Reuses
          // the canonical oz->bbl helper (COALESCE(volume_bbl, volume_oz/3968) x
          // unit_count); packaged cans/bottles carry only volume_oz. Null when
          // volume_oz is missing — we then leave volume_bbl null (never NaN) and
          // record a warning so TTB under-reporting is visible, not silent.
          const unitFillBbl = computeUnitFillVolumeBbl({
            unit_count: mapping.selling_formats?.unit_count ?? null,
            container: {
              volume_bbl: null,
              volume_oz: mapping.selling_formats?.containers?.volume_oz ?? null,
            },
          });
          if (unitFillBbl == null) {
            const warning = `Line ${lineItem.uid ?? "unknown"} (selling format ${mapping.selling_format_id}) has no container volume_oz; allocation.volume_bbl left null (TTB removals under-report this sale)`;
            warnings.push(warning);
            log.warn({ selling_format_id: mapping.selling_format_id }, warning);
          }

          // Draw FIFO across the sorted lots, mirroring suggestFifoAllocations
          // (src/domain/consumption-planning.ts): for each lot take
          // min(remaining, lot.quantity), record one allocation + one debit for
          // exactly that draw, and stop when the sale is covered.
          let remaining = quantity;
          // True when any debit_bin_inventory call clamped at zero: a
          // concurrent sale drained the bin between our unlocked read above and
          // the row-locked debit, so the plan's `draw` overstated what was
          // physically there. remaining is still decremented by the full draw,
          // so this flag is the only oversell signal in that race.
          let clampedRace = false;
          for (const lot of sortedLots) {
            if (remaining <= 0) break;
            const draw = Math.min(remaining, lot.quantity);
            if (draw <= 0) continue;

            // Audit/TTB ledger: one allocation per lot drawn, quantity == draw
            // (only what physically existed — never the un-covered shortfall).
            // volume_bbl feeds get_ttb_removals_summary's taproom_sale arm.
            const { error: allocError } = await admin.from("allocations").insert({
              source_type: "finished_good",
              source_id: lot.finished_good_id,
              destination_type: "taproom_sale",
              destination_id: null,
              quantity: draw,
              volume_bbl: unitFillBbl != null ? unitFillBbl * draw : null,
              reason_code: "other",
              status: "completed",
              completed_at: event.created_at ?? new Date().toISOString(),
              notes: `Square order ${orderId}`,
            });
            if (allocError) throw allocError;

            // Physical debit (D2): atomic, row-locked RPC. supabase-js does not
            // throw on error — surface it so the per-line catch records the line
            // as FAILED rather than silently counting it synced.
            // ponytail: the allocation insert and this debit are not wrapped in
            // a single DB transaction, so a debit failure after the insert
            // leaves an orphan allocation row. Same ceiling on a clamped race:
            // the allocation row already inserted above records the full `draw`
            // and so overstates the physical debit — exact accounting would
            // need the RPC to return the actual debited amount (or fold both
            // writes into one RPC). Acceptable — the line is flagged (failed or
            // clamped) in square_sync_log and reconciled from there.
            const { data: debitResult, error: debitError } = await admin.rpc(
              "debit_bin_inventory",
              {
                p_bin_id: resolvedBin.id,
                p_finished_good_id: lot.finished_good_id,
                p_qty: draw,
              }
            );
            if (debitError) throw debitError;
            // Missing/null data reads as not-clamped; only an explicit
            // clamped=true row flags the race.
            if (debitResult?.[0]?.clamped === true) clampedRace = true;

            remaining -= draw;
          }

          // Oversell (D3), two triggers: the FIFO plan fell short of the sold
          // quantity (remaining > 0), OR the plan looked covered but a debit
          // was clamped at zero by a concurrent sale (clampedRace — remaining
          // is 0 and the true shortfall is unknowable, so shortfallQty stays
          // 0; the `clamped` flag is the signal). Only what physically existed
          // was debited; surface for the response + log. The sale still counts
          // as synced.
          if (remaining > 0 || clampedRace) {
            oversoldLines.push({
              lineItemUid: lineItem.uid ?? "unknown",
              brandId: mapping.brand_id,
              sellingFormatId: mapping.selling_format_id,
              soldQty: quantity,
              binQuantityBefore,
              shortfallQty: remaining,
              ...(clampedRace ? { clamped: true } : {}),
            });
          }

          itemsSynced++;
        } else {
          // ---------------------------------------------------------------
          // Draft sale: insert into square_draft_sales
          // ---------------------------------------------------------------

          if (!locationId) {
            itemsFailed++;
            errors.push({
              lineItemUid: lineItem.uid ?? "unknown",
              error: `Draft sale requires a mapped location but Square location ${squareLocationId} is not mapped to a POS bin`,
            });
            continue;
          }

          const volumeOz = calculateVolumeOz(quantity);

          // supabase-js does not throw on error — a swallowed failure here
          // would still run itemsSynced++, hold the claim, and 200: the pour
          // would be unrecoverable AND invisible. Surface it so the per-line
          // catch records the line as FAILED (same handling as allocError /
          // debitError on the packaged path).
          const { error: draftError } = await admin.from("square_draft_sales").insert({
            square_order_id: orderId,
            square_payment_id: paymentId ?? null,
            brand_id: mapping.brand_id,
            selling_format_id: mapping.selling_format_id,
            quantity,
            volume_oz: volumeOz,
            unit_price_cents: lineItem.basePriceMoney?.amount
              ? Number(lineItem.basePriceMoney.amount)
              : 0,
            location_id: locationId,
            sold_at: event.created_at ?? new Date().toISOString(),
          });
          if (draftError) throw draftError;

          itemsSynced++;
        }
      } catch (err) {
        itemsFailed++;
        errors.push({
          lineItemUid: lineItem.uid ?? "unknown",
          error: errorMessage(err),
        });
      }
    }

    // Finalise the claimed sync-log row (logId is always set now that dedup
    // keys on the payment id — there is no unguarded fallback path).
    const logDetails = {
      order_id: orderId,
      payment_id: paymentId,
      square_location_id: squareLocationId,
      line_item_count: order.lineItems.length,
      ...(errors.length > 0 ? { errors } : {}),
      ...(oversoldLines.length > 0 ? { oversoldLines } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    };

    // Deliberately NOT thrown on: the debits/allocations above already
    // happened, so a 500 here would free the claim and Square's retry would
    // DOUBLE-debit the sale. An unfinalized row (completed_at NULL) is visible
    // in the sync log; log the failure so observability loss isn't silent.
    const { error: finalizeError } = await admin
      .from("square_sync_log")
      .update({
        location_id: locationId,
        items_synced: itemsSynced,
        items_failed: itemsFailed,
        details: logDetails,
        completed_at: new Date().toISOString(),
      })
      .eq("id", logId);
    if (finalizeError) {
      log.error(
        { err: finalizeError.message, log_id: logId, order_id: orderId },
        "Failed to finalize sale sync-log row (sale WAS processed)"
      );
    }

    // Return the oversold lines (D3) so POST can echo them in the response.
    return { kind: "processed", oversoldLines };
  } catch (err) {
    // Free the claimed slot on failure so Square's retry can re-process. If the
    // delete itself fails the claim strands — the stale-claim takeover above is
    // the backstop — but log it so the strand is observable.
    const { error: freeError } = await admin
      .from("square_sync_log")
      .delete()
      .eq("id", logId);
    if (freeError) {
      log.error(
        { err: freeError.message, log_id: logId },
        "Failed to free sale claim after processing error; stale-claim takeover will recover it"
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// refund.created / refund.updated handler (audit IN-3)
// ---------------------------------------------------------------------------

/** One reversed lot draw, recorded in square_sync_log.details.reversals. */
type RefundReversal = {
  allocationId: string;
  finishedGoodId: string;
  reversedQuantity: number;
  reversedVolumeBbl: number | null;
};

/**
 * Reverse a COMPLETED Square refund against a sale this system ingested.
 *
 * REVERSAL MECHANISM (investigated for audit IN-3; full rationale in 00241):
 * the original taproom_sale allocations can be neither DELETEd (00211's
 * trg_prevent_completed_allocation_delete) nor status-cancelled (00205's
 * allocation state machine makes 'completed' terminal), so the reversal is the
 * mechanism 00211 itself prescribes — an INVERSE adjustment allocation per
 * original lot draw: destination_type 'adjustment', reason_code 'refund',
 * NEGATIVE quantity and volume_bbl (permitted for adjustment rows since
 * 00241). The negative volume lands in get_ttb_removals_summary's
 * adjustments_bbl, which get_ttb_report sums into total_removals_bbl — so TTB
 * removals net out in the REFUND month (a filed sale month is never
 * rewritten) and ending inventory recovers in get_ttb_inventory_summary. The
 * negative quantity restores ledger unit availability (00010 views), so the
 * credit_bin_inventory credit below is actually POS-sellable again through
 * sellable_inventory's LEAST(bin, ledger) clamp (00226). Adjustment rows are
 * exempt from the 00212 availability guard and revision-logged by 00211's
 * trigger.
 *
 * The original lot draws are found by the linkage the sale path writes:
 * completed taproom_sale allocations whose notes equal "Square order <id>".
 *
 * Partial refunds: the PaymentRefund object carries no line-item detail, so
 * the refunded fraction (amount_money / order total) is applied to EVERY lot
 * draw, FLOORED — floor(q·f₁)+floor(q·f₂)+… ≤ q·Σf ≤ q because Square caps
 * cumulative refunds at the payment total, so repeated partial refunds can
 * never over-reverse a draw. Proportional reversals are flagged in
 * square_sync_log.details (proportional: true).
 *
 * KNOWN ceilings (documented, accepted):
 * - A refund whose order was never ingested is 200-ignored (per the sale-gate
 *   below); if the sale's own delivery is still queued behind an outage and
 *   arrives AFTER the refund, the reversal is lost (visible: the refund is
 *   absent from square_sync_log). Square delivers payments before refunds in
 *   practice; only cross-event reordering during recovery hits this.
 * - Like the sale path, the allocation insert and the bin credit are not one
 *   DB transaction; a credit failure after the insert is flagged FAILED in the
 *   sync log and reconciled from there.
 */
async function handleCompletedRefund(
  event: SquareWebhookEvent
): Promise<PaymentIngestResult | undefined> {
  const refund = event.data?.object?.refund;
  if (!refund) {
    log.warn("refund event missing refund object");
    return;
  }

  // Mirror of the payment lifecycle: only reverse once COMPLETED; acknowledge
  // (and ignore) PENDING/REJECTED/FAILED so Square does not retry.
  if (refund.status !== "COMPLETED") {
    log.info(
      { refund_id: refund.id, status: refund.status, type: event.type },
      "Refund not COMPLETED; acknowledged and ignored"
    );
    return;
  }

  const refundId = refund.id;
  const orderId = refund.order_id;
  const paymentId = refund.payment_id;
  const squareLocationId = refund.location_id;

  if (!refundId) {
    log.warn(
      { event_id: event.event_id },
      "Refund event has no refund id; cannot dedup, ignoring"
    );
    return;
  }
  // The order id is required twice over: the sale claim is keyed on it (a sale
  // claim keyed on the payment-id FALLBACK never completes — order-less
  // payments free their claim and ingest nothing, so there is nothing to
  // reverse) and the original allocations are matched through it.
  if (!orderId) {
    log.warn(
      { refund_id: refundId, payment_id: paymentId },
      "COMPLETED refund missing order_id; cannot resolve the ingested sale, ignoring"
    );
    return;
  }

  const admin = await createAdminClient();

  // Gate on the ORIGINAL sale (same claim-key logic as the payment path):
  // only refunds of orders this system ingested are reversed. No claim → not
  // an MGR sale, or pre-integration → 200 so Square stops delivering.
  const { data: saleClaim, error: saleClaimError } = await admin
    .from("square_sync_log")
    .select("completed_at, started_at")
    .eq("sync_type", "sale_ingest")
    .eq("square_payment_id", orderId)
    .maybeSingle();
  // A transient read failure is NOT "unknown order": throw → 500 → retry
  // (same policy as every read on the sale path).
  if (saleClaimError) throw saleClaimError;

  if (!saleClaim) {
    log.info(
      { refund_id: refundId, order_id: orderId, payment_id: paymentId },
      "Refund references an order this system never ingested (not an MGR sale, or pre-integration); acknowledged and ignored"
    );
    return;
  }
  if (saleClaim.completed_at == null) {
    // The sale itself is still being ingested (or crashed recently): 503 so
    // the refund is retried AFTER the sale claim resolves — reversing before
    // the sale's allocations exist would reverse nothing (audit IN-1 logic
    // applied across the two event streams).
    const startedAtMs = saleClaim.started_at ? Date.parse(saleClaim.started_at) : NaN;
    const retryAfterSeconds = Number.isFinite(startedAtMs)
      ? Math.max(1, Math.ceil((startedAtMs + STALE_CLAIM_MS - Date.now()) / 1000))
      : 1;
    log.warn(
      { refund_id: refundId, order_id: orderId, retryAfterSeconds },
      "Refund arrived while its sale claim is unfinished; 503 so Square retries"
    );
    return { kind: "in_flight", retryAfterSeconds };
  }

  // Race-safe dedup, mirroring the sale-claim discipline (claimIngestSlot),
  // keyed on the REFUND id: the UNIQUE square_payment_id column spans all sync
  // types and the order-id slot is held by the sale claim above — and one
  // order can be partially refunded several times, each refund reversing
  // exactly once.
  const claim = await claimIngestSlot(admin, {
    syncType: "refund_ingest",
    claimKey: refundId,
    eventId: event.event_id ?? null,
  });
  if (claim.kind === "duplicate") {
    log.info(
      { refund_id: refundId, order_id: orderId },
      "Duplicate refund (already reversed), skipping"
    );
    return;
  }
  if (claim.kind === "in_flight") {
    log.warn(
      { refund_id: refundId, order_id: orderId, retryAfterSeconds: claim.retryAfterSeconds },
      "Refund claim in flight (unfinished, not yet stale); 503 so Square retries"
    );
    return { kind: "in_flight", retryAfterSeconds: claim.retryAfterSeconds };
  }
  if (claim.kind === "taken_over") {
    log.warn(
      { refund_id: refundId, order_id: orderId, log_id: claim.logId },
      "Took over stale in-flight refund claim; re-processing"
    );
  }
  const logId = claim.logId;

  try {
    // -----------------------------------------------------------------------
    // Reads first: everything that may THROW (→ claim freed below → 500 →
    // Square retries) happens BEFORE the first reversal insert. After the
    // first side effect nothing throws — errors are caught-and-flagged per
    // item — because a freed claim would re-run the WHOLE reversal on retry
    // and double-reverse (same rule as the sale path's per-line catches +
    // non-throwing finalize).
    // -----------------------------------------------------------------------

    const client = await getSquareClient();
    if (!client) {
      throw new Error("Square client not available");
    }

    // The order total sizes the reversal (full vs proportional). Square money
    // amounts are integer minor units and Square caps cumulative refunds at
    // the payment total, so `refundAmount >= orderTotal` detects a full
    // refund exactly.
    const orderResponse = await client.orders.get({ orderId });
    const orderTotal = Number(orderResponse.order?.totalMoney?.amount);
    const refundAmount = Number(refund.amount_money?.amount);
    const totalKnown = Number.isFinite(orderTotal) && orderTotal > 0;
    const amountKnown = Number.isFinite(refundAmount) && refundAmount > 0;
    const isFull = totalKnown && amountKnown && refundAmount >= orderTotal;
    const proportion =
      totalKnown && amountKnown ? Math.min(1, refundAmount / orderTotal) : null;

    // The exact ledger record of what the sale ingested: one completed
    // taproom_sale allocation per lot drawn, linked by the notes the sale path
    // writes. Only MGR-mapped lines were ever allocated, so non-MGR lines on a
    // mixed order need no handling here.
    const { data: saleAllocs, error: allocReadError } = await admin
      .from("allocations")
      .select("id, source_id, quantity, volume_bbl")
      .eq("destination_type", "taproom_sale")
      .eq("status", "completed")
      .eq("notes", `Square order ${orderId}`);
    if (allocReadError) throw allocReadError;

    // Resolve the POS bin to credit from the refund's Square location — the
    // same lookup the sale path used to resolve the bin it debited. A missing
    // mapping does NOT block the ledger reversal (TTB must net out
    // regardless); the skipped credit is flagged below.
    let resolvedBin: { id: string; location_id: string } | null = null;
    if (squareLocationId) {
      const { data: bin, error: binLookupError } = await admin
        .from("bins")
        .select("id, location_id")
        .eq("square_location_id", squareLocationId)
        .maybeSingle();
      if (binLookupError) throw binLookupError;
      resolvedBin = bin ?? null;
    }

    // Staged draft (keg pour) rows for this order, handled after the loop.
    const { data: draftRows, error: draftReadError } = await admin
      .from("square_draft_sales")
      .select("id")
      .eq("square_order_id", orderId)
      .is("voided_at", null);
    if (draftReadError) throw draftReadError;

    let itemsSynced = 0;
    let itemsFailed = 0;
    const errors: Array<{ item: string; error: string }> = [];
    const warnings: string[] = [];
    const reversals: RefundReversal[] = [];
    let draftRowsVoided = 0;
    const completedAt = event.created_at ?? new Date().toISOString();

    if (proportion == null) {
      // Cannot size the reversal (missing/zero refund amount or order total).
      // Retrying is useless (same payload), so fail DURABLY: the completed
      // claim keeps the refund visible in the sync log for manual reversal.
      itemsFailed++;
      const problem = `Cannot size refund reversal: refund amount ${String(
        refund.amount_money?.amount ?? "(missing)"
      )} vs order total ${String(
        orderResponse.order?.totalMoney?.amount ?? "(missing)"
      )}; reverse manually from this log entry`;
      errors.push({ item: "sizing", error: problem });
      log.error({ refund_id: refundId, order_id: orderId }, problem);
    } else {
      for (const alloc of saleAllocs ?? []) {
        try {
          if (!alloc.source_id) {
            throw new Error("Original allocation has no source finished good");
          }

          // Full refund reverses each draw exactly; partial refunds FLOOR the
          // proportional share (see the function comment for why floor can
          // never cumulatively over-reverse). A floored-to-zero draw is
          // skipped and flagged.
          const reversedQty = isFull
            ? alloc.quantity
            : Math.floor(alloc.quantity * proportion);
          if (reversedQty <= 0) {
            warnings.push(
              `Allocation ${alloc.id}: proportional reversal floored to zero (quantity ${alloc.quantity} × ${proportion.toFixed(6)}); nothing reversed for this lot draw`
            );
            continue;
          }

          // Per-unit volume from the ORIGINAL row — never recomputed from
          // today's container config, which may have changed since the sale.
          const perUnitVolumeBbl =
            alloc.volume_bbl != null && alloc.quantity > 0
              ? alloc.volume_bbl / alloc.quantity
              : null;
          const reversedVolumeBbl =
            perUnitVolumeBbl != null ? -(perUnitVolumeBbl * reversedQty) : null;
          if (reversedVolumeBbl == null) {
            warnings.push(
              `Allocation ${alloc.id} has no volume_bbl; reversal volume left null (the sale never counted toward TTB removals, so there is no volume to net out)`
            );
          }

          // The inverse adjustment (mechanism rationale above / 00241).
          const { error: reverseError } = await admin.from("allocations").insert({
            source_type: "finished_good",
            source_id: alloc.source_id,
            destination_type: "adjustment",
            destination_id: null,
            quantity: -reversedQty,
            volume_bbl: reversedVolumeBbl,
            reason_code: "refund",
            status: "completed",
            completed_at: completedAt,
            notes: `Square refund ${refundId} of order ${orderId}`,
          });
          if (reverseError) throw reverseError;

          // Physical credit — row-locked twin of the sale's debit (00241).
          // ponytail: like the sale path, the allocation insert and this
          // credit are not one DB transaction; a credit failure after the
          // insert leaves the ledger reversed but the bin uncredited — the
          // item is flagged FAILED here and reconciled from the sync log.
          if (resolvedBin) {
            const { error: creditError } = await admin.rpc("credit_bin_inventory", {
              p_bin_id: resolvedBin.id,
              p_finished_good_id: alloc.source_id,
              p_qty: reversedQty,
            });
            if (creditError) throw creditError;
          } else {
            warnings.push(
              `Square location ${squareLocationId ?? "(none)"} is not mapped to a POS bin; ledger reversed for allocation ${alloc.id} but no bin credited`
            );
          }

          reversals.push({
            allocationId: alloc.id,
            finishedGoodId: alloc.source_id,
            reversedQuantity: reversedQty,
            reversedVolumeBbl,
          });
          itemsSynced++;
        } catch (err) {
          itemsFailed++;
          errors.push({ item: `allocation ${alloc.id}`, error: errorMessage(err) });
        }
      }

      // Draft (keg pour) lines: staged in square_draft_sales, not yet
      // allocated (reconciliation is backlog #7 — no draft row is reconciled
      // today; once that flow lands, reconciled pours will carry the same
      // notes linkage and reverse through the loop above like packaged
      // lines). A FULL refund voids the staged rows so reconciliation skips
      // them; a PARTIAL refund cannot know which pours were refunded (no line
      // detail on the refund object) — leave the rows and flag for manual
      // review. Caught-and-flagged, never thrown: reversals were already
      // inserted above.
      if ((draftRows ?? []).length > 0) {
        if (isFull) {
          const { error: voidError } = await admin
            .from("square_draft_sales")
            .update({ voided_at: new Date().toISOString() })
            .eq("square_order_id", orderId)
            .is("voided_at", null);
          if (voidError) {
            itemsFailed++;
            errors.push({ item: "draft_sales", error: voidError.message });
          } else {
            draftRowsVoided = (draftRows ?? []).length;
          }
        } else {
          warnings.push(
            `Partial refund: ${(draftRows ?? []).length} staged draft (keg pour) row(s) left un-voided for manual review`
          );
        }
      }
    }

    const logDetails = {
      refund_id: refundId,
      order_id: orderId,
      payment_id: paymentId ?? null,
      square_location_id: squareLocationId ?? null,
      refund_amount: amountKnown ? refundAmount : null,
      order_total: totalKnown ? orderTotal : null,
      proportional: proportion != null && !isFull,
      ...(proportion != null && !isFull
        ? { proportion: Number(proportion.toFixed(6)) }
        : {}),
      ...(reversals.length > 0 ? { reversals } : {}),
      ...(draftRowsVoided > 0 ? { draft_rows_voided: draftRowsVoided } : {}),
      ...(errors.length > 0 ? { errors } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    };

    // Deliberately NOT thrown on: the reversals above already happened, so a
    // 500 here would free the claim and Square's retry would DOUBLE-reverse.
    // An unfinalized row (completed_at NULL) is visible in the sync log; log
    // the failure so observability loss isn't silent.
    const { error: finalizeError } = await admin
      .from("square_sync_log")
      .update({
        location_id: resolvedBin?.location_id ?? null,
        items_synced: itemsSynced,
        items_failed: itemsFailed,
        details: logDetails,
        completed_at: new Date().toISOString(),
      })
      .eq("id", logId);
    if (finalizeError) {
      log.error(
        { err: finalizeError.message, log_id: logId, refund_id: refundId },
        "Failed to finalize refund sync-log row (refund WAS processed)"
      );
    }

    return { kind: "processed", oversoldLines: [] };
  } catch (err) {
    // Free the claimed slot on failure so Square's retry can re-process (only
    // pre-side-effect reads can throw here — see the reads-first rule above).
    // If the delete itself fails the claim strands — the stale-claim takeover
    // is the backstop — but log it so the strand is observable.
    const { error: freeError } = await admin
      .from("square_sync_log")
      .delete()
      .eq("id", logId);
    if (freeError) {
      log.error(
        { err: freeError.message, log_id: logId },
        "Failed to free refund claim after processing error; stale-claim takeover will recover it"
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// inventory.count.updated handler
// ---------------------------------------------------------------------------

async function handleInventoryCountUpdated(event: SquareWebhookEvent) {
  // MGR is the source of truth for inventory — log the event for visibility
  // but do not update any MGR inventory data.

  // event_id is the dedup key here; NULLs are distinct under the UNIQUE
  // constraint, so an id-less event would insert an unbounded duplicate row on
  // every Square retry. It also cannot be traced back to anything — skip the
  // durable log entirely (this row is informational only).
  if (!event.event_id) {
    log.warn("inventory.count.updated event missing event_id; not logging");
    return;
  }

  const admin = await createAdminClient();

  // supabase-js does not throw on error — surface it so the outer handler
  // returns 500 and Square retries, rather than silently dropping the log row.
  // sync_type "inventory_event" (00233) marks this as an INBOUND notification,
  // distinct from "inventory_push" (MGR pushing counts out) so the sync status
  // page's push history isn't polluted with Square's own echoes.
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
    { onConflict: "event_id", ignoreDuplicates: true }
  );
  if (error) throw error;
}
