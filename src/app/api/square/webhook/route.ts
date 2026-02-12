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

// Square webhook event shape (subset of fields we care about)
interface SquareWebhookEvent {
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

  // 7. Route by event type — always return 200 quickly to avoid Square retries
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
    // Log error but still return 200 to prevent Square retries.
    // The error details are captured in the sync log where possible.
    console.error(
      `[Square Webhook] Error processing ${event.type}:`,
      err instanceof Error ? err.message : err
    );
  }

  return NextResponse.json({ received: true });
}

// ---------------------------------------------------------------------------
// payment.completed handler
// ---------------------------------------------------------------------------

async function handlePaymentCompleted(event: SquareWebhookEvent) {
  const payment = event.data?.object?.payment;
  if (!payment) {
    console.warn("[Square Webhook] payment.completed event missing payment object");
    return;
  }

  const orderId = payment.order_id;
  const paymentId = payment.id;
  const squareLocationId = payment.location_id;

  if (!orderId) {
    console.warn("[Square Webhook] payment.completed event missing order_id");
    return;
  }

  const admin = await createAdminClient();

  // Check for duplicate processing (idempotency via order_id in details JSONB)
  const { data: existingLog } = await admin
    .from("square_sync_log")
    .select("id")
    .eq("sync_type", "sale_ingest")
    .contains("details", { order_id: orderId })
    .limit(1)
    .maybeSingle();

  if (existingLog) {
    console.info(
      `[Square Webhook] Duplicate payment.completed for order ${orderId}, skipping`
    );
    return;
  }

  // Fetch full order details from Square
  const client = await getSquareClient();
  if (!client) {
    console.error("[Square Webhook] Square client not available");
    return;
  }

  const orderResponse = await client.orders.get({ orderId });
  const order = orderResponse.order;

  if (!order?.lineItems?.length) {
    console.info(
      `[Square Webhook] Order ${orderId} has no line items, skipping`
    );
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
      // Look up the catalog mapping
      const { data: mapping } = await admin
        .from("square_catalog_map")
        .select("id, brand_id, package_type_id, keg_type_id")
        .eq("square_catalog_id", catalogObjectId)
        .eq("object_type", "ITEM_VARIATION")
        .maybeSingle();

      if (!mapping) {
        // No mapping found — could be a non-MGR product sold on Square
        continue;
      }

      const quantity = parseInt(lineItem.quantity, 10) || 0;
      if (quantity <= 0) continue;

      if (mapping.package_type_id) {
        // ---------------------------------------------------------------
        // Packaged good sale: create a completed allocation
        // ---------------------------------------------------------------

        // Find the most relevant finished good for this brand + package type
        // (pick the one with the most available stock via FIFO by production date)
        const { data: fg } = await admin
          .from("finished_goods_with_availability")
          .select("id")
          .eq("brand_id", mapping.brand_id)
          .eq("package_type_id", mapping.package_type_id)
          .gt("available_quantity", 0)
          .order("production_date", { ascending: true })
          .limit(1)
          .maybeSingle();

        await admin.from("allocations").insert({
          source_type: "finished_good",
          source_id: fg?.id ?? null,
          destination_type: "taproom_sale",
          destination_id: null,
          quantity,
          status: "completed",
          completed_at: event.created_at ?? new Date().toISOString(),
          notes: `Square order ${orderId}`,
        });

        itemsSynced++;
      } else if (mapping.keg_type_id) {
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
          keg_type_id: mapping.keg_type_id,
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

  // Log the sync operation
  await admin.from("square_sync_log").insert({
    sync_type: "sale_ingest",
    location_id: locationId,
    items_synced: itemsSynced,
    items_failed: itemsFailed,
    details: {
      order_id: orderId,
      payment_id: paymentId,
      square_location_id: squareLocationId,
      event_id: event.event_id,
      line_item_count: order.lineItems.length,
      ...(errors.length > 0 ? { errors } : {}),
    },
    completed_at: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// inventory.count.updated handler
// ---------------------------------------------------------------------------

async function handleInventoryCountUpdated(event: SquareWebhookEvent) {
  // MGR is the source of truth for inventory — log the event for visibility
  // but do not update any MGR inventory data.
  const admin = await createAdminClient();

  await admin.from("square_sync_log").insert({
    sync_type: "inventory_push",
    items_synced: 0,
    items_failed: 0,
    details: {
      event_type: "inventory.count.updated",
      event_id: event.event_id,
      note: "Logged for informational purposes only. MGR is source of truth for inventory.",
      raw_data: JSON.parse(JSON.stringify(event.data ?? null)),
    },
    completed_at: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STANDARD_POUR_OZ = 16;

function calculateVolumeOz(quantity: number): number {
  return quantity * STANDARD_POUR_OZ;
}
