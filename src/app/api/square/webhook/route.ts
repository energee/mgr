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
 *   - payment.completed: Ingests sale data. Packaged lines resolve the Square
 *     location to a POS bin, debit that bin's FIFO finished good (RPC
 *     debit_bin_inventory) and record a taproom_sale allocation; oversells clamp
 *     the bin to 0 and are surfaced in the response + sync log. Draft pours are
 *     staged in square_draft_sales (keg depletion is deferred).
 *   - inventory.count.updated: Logged for informational purposes only (MGR is
 *     the source of truth for inventory).
 *   - All other events: Acknowledged with 200 but ignored.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getSquareClient, getSquareSettings } from "@/integrations/square/client";
import { checkReplayWindow, verifyWebhookSignature } from "@/integrations/square/webhook";
import { calculateVolumeOz } from "@/integrations/square/utils";
import type { SquareSyncType } from "@/integrations/square/types";
import { dynamicFrom } from "@/services/types";
import { logger } from "@/lib/logger";

const log = logger.child({ route: "/api/square/webhook" });

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
      };
      // inventory.count.updated nests differently
      [key: string]: unknown;
    };
  };
}

/**
 * A packaged sale line whose sold quantity exceeded the physical count in its
 * resolved POS bin (D3 oversell). The bin was clamped to 0; the sale still
 * succeeds (itemsSynced). Surfaced in the webhook response and durably in
 * square_sync_log.details so the POS/caller can reconcile.
 */
type OversoldLine = {
  lineItemUid: string;
  brandId: string;
  sellingFormatId: string;
  soldQty: number;
  binQuantityBefore: number;
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
      case "payment.completed": {
        const result = await handlePaymentCompleted(event);
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
    // event_id guarantees only one retry can actually re-process.
    log.error(
      { err: err instanceof Error ? err.message : err, event_id: event.event_id, type: event.type },
      `Error processing ${event.type}; Square will retry`
    );
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }

  // D3: the sale succeeded, but one or more packaged lines sold more units than
  // the resolved bin physically held (clamped to 0). Surface them so the caller
  // can reconcile; they are also recorded in square_sync_log.details.
  return NextResponse.json(
    oversoldLines.length > 0
      ? { received: true, oversoldLines }
      : { received: true }
  );
}

// ---------------------------------------------------------------------------
// payment.completed handler
// ---------------------------------------------------------------------------

async function handlePaymentCompleted(event: SquareWebhookEvent) {
  const payment = event.data?.object?.payment;
  if (!payment) {
    log.warn("payment.completed event missing payment object");
    return;
  }

  const orderId = payment.order_id;
  const paymentId = payment.id;
  const squareLocationId = payment.location_id;

  if (!orderId) {
    log.warn("payment.completed event missing order_id");
    return;
  }

  const admin = await createAdminClient();

  // Race-safe dedup (audit F-135): claim the event_id row before any side
  // effects. ON CONFLICT DO NOTHING returns empty data on duplicate, so
  // concurrent retries cannot both proceed past this point. Fallback: if
  // event_id is absent (Square contract change), proceed without dedup —
  // don't synthesize from order_id, which would mask that contract change.
  let logId: string | null = null;
  if (event.event_id) {
    const { data: claimed } = await admin
      .from("square_sync_log")
      .upsert(
        {
          sync_type: "sale_ingest" satisfies SquareSyncType,
          event_id: event.event_id,
          items_synced: 0,
          items_failed: 0,
        },
        { onConflict: "event_id", ignoreDuplicates: true }
      )
      .select("id");

    if (!claimed || claimed.length === 0) {
      log.info(
        { event_id: event.event_id, order_id: orderId },
        "Duplicate payment.completed, skipping"
      );
      return;
    }
    logId = claimed[0].id;
  } else {
    log.warn(
      { order_id: orderId },
      "payment.completed missing event_id; proceeding without race-safe dedup"
    );
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
      if (logId) {
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
      }
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
      const { data: bin } = await admin
        .from("bins")
        .select("id, location_id, pos_sales_channel_id")
        .eq("square_location_id", squareLocationId)
        .maybeSingle();
      resolvedBin = bin ?? null;
    }
    // MGR location used for draft staging (below) and the sync-log row. Derived
    // once from the resolved bin so both the packaged and draft branches agree.
    const locationId: string | null = resolvedBin?.location_id ?? null;

    let itemsSynced = 0;
    let itemsFailed = 0;
    const errors: Array<{ lineItemUid: string; error: string }> = [];
    const oversoldLines: OversoldLine[] = [];

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
          // Packaged good sale: debit the resolved bin's FIFO finished good
          // (D2) and record a taproom_sale allocation (audit/TTB ledger).
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

          // Pick the finished good to debit: FIFO by production date, restricted
          // to stock physically in THIS bin for the sold brand + selling format.
          // Uses dynamicFrom because the strongly-typed builder rejects the
          // embedded-resource filters (finished_goods.brand_id) — same idiom the
          // old finished_goods_with_availability lookup used.
          const { data: binRow } = await dynamicFrom(admin, "bin_inventory")
            .select(
              "finished_good_id, quantity, finished_goods!inner(production_date, brand_id, selling_format_id)"
            )
            .eq("bin_id", resolvedBin.id)
            .eq("finished_goods.brand_id", mapping.brand_id)
            .eq("finished_goods.selling_format_id", mapping.selling_format_id)
            .gt("quantity", 0)
            .order("production_date", { ascending: true, referencedTable: "finished_goods" })
            .limit(1)
            .maybeSingle();

          if (!binRow) {
            itemsFailed++;
            errors.push({
              lineItemUid: lineItem.uid ?? "unknown",
              error: `No finished good with available inventory in bin ${resolvedBin.id} for brand ${mapping.brand_id} / selling format ${mapping.selling_format_id}`,
            });
            continue;
          }

          // Audit/TTB ledger: records what was SOLD (full quantity). Independent
          // of the physical bin count debited below — only this path writes
          // bin_inventory, so keeping both is not a double-count.
          await admin.from("allocations").insert({
            source_type: "finished_good",
            source_id: binRow.finished_good_id,
            destination_type: "taproom_sale",
            destination_id: null,
            quantity,
            status: "completed",
            completed_at: event.created_at ?? new Date().toISOString(),
            notes: `Square order ${orderId}`,
          });

          // Physical debit (D2): atomic, row-locked RPC that clamps to 0 on
          // oversell (never negative). We do NOT clamp the allocation quantity
          // above — the ledgers are intentionally independent.
          const { data: debit } = await admin.rpc("debit_bin_inventory", {
            p_bin_id: resolvedBin.id,
            p_finished_good_id: binRow.finished_good_id,
            p_qty: quantity,
          });
          const debitRow = debit?.[0];

          // Oversell (D3): sold more than the bin held. The sale still succeeds
          // (the bin clamped to 0); collect the line for the response + log.
          if (debitRow?.clamped) {
            oversoldLines.push({
              lineItemUid: lineItem.uid ?? "unknown",
              brandId: mapping.brand_id,
              sellingFormatId: mapping.selling_format_id,
              soldQty: quantity,
              binQuantityBefore: binRow.quantity,
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

    // Finalise the sync log: update the claimed row, or insert a fresh row
    // for the no-event_id fallback path.
    const logDetails = {
      order_id: orderId,
      payment_id: paymentId,
      square_location_id: squareLocationId,
      line_item_count: order.lineItems.length,
      ...(errors.length > 0 ? { errors } : {}),
      ...(oversoldLines.length > 0 ? { oversoldLines } : {}),
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
        sync_type: "sale_ingest" satisfies SquareSyncType,
        event_id: null,
        location_id: locationId,
        items_synced: itemsSynced,
        items_failed: itemsFailed,
        details: logDetails,
        completed_at: new Date().toISOString(),
      });
    }

    // Return the oversold lines (D3) so POST can echo them in the response.
    return { oversoldLines };
  } catch (err) {
    // Free the claimed slot on failure so Square's retry can re-process.
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
      sync_type: "inventory_push" satisfies SquareSyncType,
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
}
