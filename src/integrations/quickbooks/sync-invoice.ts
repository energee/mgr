import { createAdminClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { qboClient } from "./client";
import {
  getMapping,
  getMappingOrLogFailure,
  upsertMapping,
  createSyncLog,
  updateSyncLog,
  getDefaultPaymentTermsDays,
} from "./sync-utils";
import { syncCustomer } from "./sync-customer";
import type { QBOInvoice, QBOInvoiceLine, QBOEntityResponse } from "./types";

function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + days);
  return date.toISOString().split("T")[0];
}

export async function syncInvoice(orderId: string): Promise<{ qboId: string; action: "create" | "update" }> {
  const admin = await createAdminClient();

  // Fetch order
  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();
  if (orderError || !order) throw new Error(`Order not found: ${orderId}`);

  // Ensure customer is synced first
  if (!order.customer_id) throw new Error("Order has no customer");

  let customerMapping = await getMapping("customer", order.customer_id);
  if (!customerMapping) {
    await syncCustomer(order.customer_id);
    customerMapping = await getMapping("customer", order.customer_id);
  }
  if (!customerMapping) throw new Error("Failed to sync customer to QBO");

  // Get customer for payment terms. A failed read falls back to the default
  // terms (due-date only), but is logged so the divergence is observable
  // (audit SF-11).
  const { data: customer, error: customerError } = await admin
    .from("customers")
    .select("payment_terms_days, is_tax_exempt")
    .eq("id", order.customer_id)
    .single();
  if (customerError) {
    logger.warn(
      { err: customerError.message, customerId: order.customer_id, orderId },
      "QBO sync: failed to read customer payment terms; falling back to default terms"
    );
  }

  const paymentTermsDays = (customer as Record<string, unknown> | null)?.payment_terms_days as number | null
    ?? await getDefaultPaymentTermsDays();

  // Fetch order items. A failed READ throws its own error — reporting it as
  // "has no line items" masked the real DB failure in qbo_sync_log
  // (audit SF-9).
  const { data: items, error: itemsError } = await admin
    .from("order_items")
    .select("*, brand:brands(name), selling_format:selling_formats(name)")
    .eq("order_id", orderId);
  if (itemsError) {
    throw new Error(
      `Failed to read line items for order ${order.order_number || orderId}: ${itemsError.message}`
    );
  }

  if (!items?.length) {
    throw new Error(`Order ${order.order_number || orderId} has no line items. Cannot create an empty invoice in QuickBooks.`);
  }

  // Build invoice lines (description-only, no QBO Item refs)
  const lines: QBOInvoiceLine[] = (items || []).map((item) => {
    const brandName = (item.brand as Record<string, unknown> | null)?.name || "Unknown";
    const formatName = (item.selling_format as Record<string, unknown> | null)?.name || "";
    const description = formatName ? `${brandName} - ${formatName}` : String(brandName);
    return {
      Amount: (item.quantity || 1) * Number(item.unit_price || 0),
      Description: description,
      DetailType: "SalesItemLineDetail" as const,
      SalesItemLineDetail: {
        Qty: item.quantity || 1,
        UnitPrice: Number(item.unit_price || 0),
      },
    };
  });

  // Create-vs-update decision — a failed mapping read throws (recorded as a
  // failed sync-log row) rather than falling through to "create", which
  // would post a duplicate Invoice into QuickBooks (audit SF-2).
  const existing = await getMappingOrLogFailure("order", orderId);
  const action = existing ? "update" : "create";
  const logId = await createSyncLog("order", orderId, action);

  try {
    const txnDate = (order.fulfilled_date || order.order_date || new Date().toISOString()).split("T")[0];
    const dueDate = addDays(txnDate, paymentTermsDays);

    const qboInvoice: QBOInvoice = {
      DocNumber: order.order_number,
      CustomerRef: { value: customerMapping.qbo_entity_id },
      TxnDate: txnDate,
      DueDate: dueDate,
      Line: lines,
    };

    let result: QBOEntityResponse<QBOInvoice>;

    if (existing) {
      const current = await qboClient.get<QBOEntityResponse<QBOInvoice>>(
        `/invoice/${existing.qbo_entity_id}`
      );
      qboInvoice.Id = existing.qbo_entity_id;
      qboInvoice.SyncToken = current.Invoice.SyncToken;
      qboInvoice.sparse = true;
      result = await qboClient.post<QBOEntityResponse<QBOInvoice>>("/invoice", qboInvoice);
    } else {
      result = await qboClient.post<QBOEntityResponse<QBOInvoice>>("/invoice", qboInvoice);
    }

    const qboId = result.Invoice.Id!;
    await upsertMapping("order", orderId, "Invoice", qboId);
    await updateSyncLog(logId, "success", result);
    return { qboId, action };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateSyncLog(logId, "error", undefined, message);
    throw err;
  }
}
