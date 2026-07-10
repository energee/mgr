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
 *     claim cannot permanently dedup-skip the sale.
 *     Packaged lines resolve the Square location to a POS bin and
 *     draw the sold quantity FIFO across every finished-good lot physically in
 *     that bin (oldest production_date first), recording one taproom_sale
 *     allocation (with volume_bbl for TTB removals) and one debit_bin_inventory
 *     call per lot drawn. If the bin cannot cover the sale — either the planned
 *     FIFO draw falls short, or a concurrent sale won the row lock and the RPC
 *     clamped a debit at zero — only the stock that physically existed is
 *     debited and the oversell is surfaced in the response + sync log. Draft
 *     (keg) pours are staged in square_draft_sales (keg depletion is deferred).
 *   - inventory.count.updated: Logged for informational purposes only (MGR is
 *     the source of truth for inventory).
 *   - All other events: Acknowledged with 200 but ignored.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getSquareClient, getSquareSettings } from "@/integrations/square/client";
import { checkReplayWindow, verifyWebhookSignature } from "@/integrations/square/webhook";
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
 * so a live in-flight handler can never be raced by its own retry.
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
  const replay = checkReplayWindow(event.created_at);
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
        oversoldLines = result?.oversoldLines ?? [];
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
// payment.created / payment.updated handler
// ---------------------------------------------------------------------------

async function handleCompletedPayment(event: SquareWebhookEvent) {
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
  // ON CONFLICT DO NOTHING (UNIQUE uniq_square_sync_log_square_payment_id)
  // returns [] on duplicate so concurrent retries cannot both proceed.
  const claimKey = orderId ?? paymentId;
  if (!claimKey) {
    log.warn(
      { event_id: event.event_id },
      "Payment event has neither order_id nor payment id; cannot dedup, ignoring"
    );
    return;
  }

  const { data: claimed, error: claimError } = await admin
    .from("square_sync_log")
    .upsert(
      {
        sync_type: "sale_ingest" satisfies SquareSyncType,
        event_id: event.event_id ?? null,
        square_payment_id: claimKey,
        items_synced: 0,
        items_failed: 0,
      },
      { onConflict: "square_payment_id", ignoreDuplicates: true }
    )
    .select("id");

  // A transient DB error must NOT be mistaken for a duplicate: on error `data`
  // is null, which would otherwise look identical to an empty (already-claimed)
  // result and silently drop the sale with a 200. Throw so the outer handler
  // returns 500 and Square retries. Only a genuine empty array is a duplicate.
  if (claimError) throw claimError;

  let logId: string;
  if (claimed && claimed.length > 0) {
    logId = claimed[0].id;
  } else {
    // Already claimed. Usually a genuine duplicate delivery — but a claim whose
    // processing crashed mid-flight (timeout after the claim committed) never
    // completes and never frees itself, and every retry would dedup-skip into
    // a permanently lost sale. Treat an UNFINISHED claim older than
    // STALE_CLAIM_MS as abandoned and take it over ATOMICALLY: the conditional
    // UPDATE re-stamps started_at only if the claim is still stale, so exactly
    // one of several concurrent retries wins (the others match zero rows).
    // NOTE: re-processing after a partial crash can re-debit lines the crashed
    // attempt already debited — at-least-once by design; the alternative (hold
    // the claim forever) silently loses the whole sale, which is worse. The
    // sync-log row survives for reconciliation either way.
    const staleCutoff = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
    const { data: takeover, error: takeoverError } = await admin
      .from("square_sync_log")
      .update({ started_at: new Date().toISOString() })
      .eq("square_payment_id", claimKey)
      .is("completed_at", null)
      .lt("started_at", staleCutoff)
      .select("id");
    if (takeoverError) throw takeoverError;
    if (!takeover || takeover.length === 0) {
      log.info(
        { payment_id: paymentId, order_id: orderId },
        "Duplicate sale (order already claimed), skipping"
      );
      return;
    }
    logId = takeover[0].id;
    log.warn(
      { payment_id: paymentId, order_id: orderId, log_id: logId },
      "Took over stale in-flight sale claim; re-processing"
    );
  }

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
        const { data: mapping } = await dynamicFrom(admin, "square_catalog_map")
          .select(
            "id, brand_id, selling_format_id, selling_formats(unit_count, containers(type, volume_oz))"
          )
          .eq("square_catalog_id", catalogObjectId)
          .eq("object_type", "ITEM_VARIATION")
          .maybeSingle();

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
    return { oversoldLines };
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
