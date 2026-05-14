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
 *   - payment.completed: Ingests sale data, creates allocations for packaged
 *     goods and draft sale records for draft pours.
 *   - inventory.count.updated: Logged for informational purposes only (MGR is
 *     the source of truth for inventory).
 *   - All other events: Acknowledged with 200 but ignored.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getSquareClient, getSquareSettings } from "@/lib/square/client";
import { verifyWebhookSignature } from "@/lib/square/webhook";
import { calculateVolumeOz } from "@/lib/square/utils";
import { dynamicFrom } from "@/services/types";
import { logger } from "@/lib/logger";

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
      };
      // inventory.count.updated nests differently
      [key: string]: unknown;
    };
  };
}

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
  const notificationUrl =
    process.env.SQUARE_WEBHOOK_URL ||
    `${process.env.NEXT_PUBLIC_APP_URL}/api/square/webhook`;

  // 5. Verify signature
  const isValid = verifyWebhookSignature(
    body,
    signature,
    settings.webhookSignatureKey,
    notificationUrl
  );

  if (!isValid) {
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

  // 6.5 Replay protection (audit F-127): reject events whose `created_at` is
  // more than 5 minutes from now. The HMAC signature alone doesn't bound the
  // replay window — a recorded request could be replayed indefinitely.
  // A missing or unparseable timestamp is also rejected: silently skipping
  // the check would leave the replay window wide open on crafted payloads.
  //
  // Rejections return 200, not 4xx. Square retries any non-2xx on exponential
  // backoff for up to 24h, and a stale event is stale on every retry — 4xx
  // would create a retry storm. The warning log preserves observability while
  // 200 acknowledges receipt and stops the retry loop.
  if (!event.created_at) {
    logger.warn(
      { event_id: event.event_id, type: event.type },
      "[Square Webhook] Acknowledged but ignored: missing created_at"
    );
    return NextResponse.json({ received: true, ignored: "missing_created_at" });
  }
  const eventTime = Date.parse(event.created_at);
  if (!Number.isFinite(eventTime)) {
    logger.warn(
      { event_id: event.event_id, created_at: event.created_at },
      "[Square Webhook] Acknowledged but ignored: invalid created_at"
    );
    return NextResponse.json({ received: true, ignored: "invalid_created_at" });
  }
  if (Math.abs(Date.now() - eventTime) > 5 * 60 * 1000) {
    logger.warn(
      { event_id: event.event_id, created_at: event.created_at },
      "[Square Webhook] Acknowledged but ignored: stale event outside the 5-minute replay window"
    );
    return NextResponse.json({ received: true, ignored: "stale_event" });
  }

  // 7. Route by event type.
  try {
    switch (event.type) {
      case "payment.completed":
        await handlePaymentCompleted(event);
        break;

      case "inventory.count.updated":
        await handleInventoryCountUpdated(event);
        break;

      default:
        // Acknowledge but ignore unknown event types
        break;
    }
  } catch (err) {
    // Processing failed after the event_id slot was claimed-and-released
    // (handlePaymentCompleted deletes the claim on error). Return 500 so
    // Square retries delivery; the UNIQUE constraint on event_id guarantees
    // only one retry can actually re-process.
    logger.error(
      { err: err instanceof Error ? err.message : err, event_id: event.event_id, type: event.type },
      `[Square Webhook] Error processing ${event.type}; Square will retry`
    );
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// ---------------------------------------------------------------------------
// payment.completed handler
// ---------------------------------------------------------------------------

async function handlePaymentCompleted(event: SquareWebhookEvent) {
  const payment = event.data?.object?.payment;
  if (!payment) {
    logger.warn("[Square Webhook] payment.completed event missing payment object");
    return;
  }

  const orderId = payment.order_id;
  const paymentId = payment.id;
  const squareLocationId = payment.location_id;

  if (!orderId) {
    logger.warn("[Square Webhook] payment.completed event missing order_id");
    return;
  }

  const admin = await createAdminClient();

  // Race-safe dedup (audit F-135): claim the event_id slot before any side
  // effects. ON CONFLICT DO NOTHING returns empty data when a duplicate is
  // detected, so both concurrent retries cannot proceed past this point.
  //
  // Square reliably sends event_id; the fallback path (no event_id) proceeds
  // without dedup. We don't synthesize a key from order_id because that would
  // mask future Square API contract changes.
  let logId: string | null = null;
  if (event.event_id) {
    const { data: claimed } = await admin
      .from("square_sync_log")
      .upsert(
        {
          sync_type: "sale_ingest",
          event_id: event.event_id,
          items_synced: 0,
          items_failed: 0,
        },
        { onConflict: "event_id", ignoreDuplicates: true }
      )
      .select("id");

    if (!claimed || claimed.length === 0) {
      logger.info(
        `[Square Webhook] Duplicate payment.completed for event ${event.event_id}, skipping`
      );
      return;
    }
    logId = claimed[0].id;
  } else {
    logger.warn(
      { order_id: orderId },
      "[Square Webhook] payment.completed missing event_id; proceeding without race-safe dedup"
    );
  }

  try {
    // Fetch full order details from Square. A missing client is a config
    // failure — throw so the catch below frees the claimed slot and the outer
    // handler returns 500; otherwise the claim sticks forever and the retry
    // would dedup-skip the (recoverable) event.
    const client = await getSquareClient();
    if (!client) {
      throw new Error("Square client not available");
    }

    const orderResponse = await client.orders.get({ orderId });
    const order = orderResponse.order;

    if (!order?.lineItems?.length) {
      // Legitimate no-op: finalize the log so the row reflects 0-item
      // completion rather than sitting in "claimed but unfinished" forever.
      logger.info(
        `[Square Webhook] Order ${orderId} has no line items, skipping`
      );
      if (logId) {
        await admin
          .from("square_sync_log")
          .update({
            items_synced: 0,
            items_failed: 0,
            details: {
              order_id: orderId,
              payment_id: paymentId,
              square_location_id: squareLocationId,
              note: "Order had no line items",
            },
            completed_at: new Date().toISOString(),
          })
          .eq("id", logId);
      }
      return;
    }

    // Resolve the MGR location from the Square location ID
    let locationId: string | null = null;
    if (squareLocationId) {
      const { data: location } = await admin
        .from("locations")
        .select("id")
        .eq("square_location_id", squareLocationId)
        .maybeSingle();

      locationId = location?.id ?? null;
    }

    let itemsSynced = 0;
    let itemsFailed = 0;
    const errors: Array<{ lineItemUid: string; error: string }> = [];

    for (const lineItem of order.lineItems) {
      const catalogObjectId = lineItem.catalogObjectId;
      if (!catalogObjectId) {
        // Non-catalog line item (custom amount), skip
        continue;
      }

      try {
        // Look up the catalog mapping with selling format container type
        const { data: mapping } = await dynamicFrom(admin, "square_catalog_map")
          .select("id, brand_id, selling_format_id, selling_formats(containers(type))")
          .eq("square_catalog_id", catalogObjectId)
          .eq("object_type", "ITEM_VARIATION")
          .maybeSingle();

        if (!mapping) {
          // No mapping found — could be a non-MGR product sold on Square
          continue;
        }

        const quantity = parseInt(lineItem.quantity, 10) || 0;
        if (quantity <= 0) continue;

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
          // Packaged good sale: create a completed allocation
          // ---------------------------------------------------------------

          // Find the most relevant finished good for this brand + selling format
          // (pick the one with the most available stock via FIFO by production date)
          const { data: fg } = await dynamicFrom(admin, "finished_goods_with_availability")
            .select("id")
            .eq("brand_id", mapping.brand_id)
            .eq("selling_format_id", mapping.selling_format_id)
            .gt("available_quantity", 0)
            .order("production_date", { ascending: true })
            .limit(1)
            .maybeSingle();

          if (!fg) {
            itemsFailed++;
            errors.push({
              lineItemUid: lineItem.uid ?? "unknown",
              error: `No finished good with available inventory found for brand ${mapping.brand_id} / selling format ${mapping.selling_format_id}`,
            });
            continue;
          }

          await admin.from("allocations").insert({
            source_type: "finished_good",
            source_id: fg.id,
            destination_type: "taproom_sale",
            destination_id: null,
            quantity,
            status: "completed",
            completed_at: event.created_at ?? new Date().toISOString(),
            notes: `Square order ${orderId}`,
          });

          itemsSynced++;
        } else {
          // ---------------------------------------------------------------
          // Draft sale: insert into square_draft_sales
          // ---------------------------------------------------------------

          if (!locationId) {
            itemsFailed++;
            errors.push({
              lineItemUid: lineItem.uid ?? "unknown",
              error: `Draft sale requires a mapped location but Square location ${squareLocationId} is not mapped to an MGR location`,
            });
            continue;
          }

          const volumeOz = calculateVolumeOz(quantity);

          await admin.from("square_draft_sales").insert({
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

          itemsSynced++;
        }
      } catch (err) {
        itemsFailed++;
        errors.push({
          lineItemUid: lineItem.uid ?? "unknown",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Finalise the sync log. If we claimed a row at the top (logId is set),
    // update it with final stats. Otherwise (no event_id) do a plain insert.
    // `event_id` is stored as a top-level column, not duplicated in details.
    const logDetails = {
      order_id: orderId,
      payment_id: paymentId,
      square_location_id: squareLocationId,
      line_item_count: order.lineItems.length,
      ...(errors.length > 0 ? { errors } : {}),
    };

    if (logId) {
      await admin
        .from("square_sync_log")
        .update({
          location_id: locationId,
          items_synced: itemsSynced,
          items_failed: itemsFailed,
          details: logDetails,
          completed_at: new Date().toISOString(),
        })
        .eq("id", logId);
    } else {
      await admin.from("square_sync_log").insert({
        sync_type: "sale_ingest",
        event_id: null,
        location_id: locationId,
        items_synced: itemsSynced,
        items_failed: itemsFailed,
        details: logDetails,
        completed_at: new Date().toISOString(),
      });
    }
  } catch (err) {
    // Compensation: free the claimed slot so Square's retry can re-acquire
    // the event_id and re-process from scratch. Without this, a transient
    // failure (network blip, Square API hiccup) silently drops the order —
    // the claim sticks and every retry hits the dedup short-circuit.
    if (logId) {
      await admin.from("square_sync_log").delete().eq("id", logId);
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
  const admin = await createAdminClient();

  await admin.from("square_sync_log").upsert(
    {
      sync_type: "inventory_push",
      event_id: event.event_id ?? null,
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
}
