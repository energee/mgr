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
  createQBORequestId,
  reconciliationRequiredError,
} from "./sync-utils";
import { syncSupplier } from "./sync-supplier";
import type { QBOBill, QBOBillLine, QBOEntityResponse } from "./types";

function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + days);
  return date.toISOString().split("T")[0];
}

/** Extract numeric days from a payment terms string like "Net 30" or "COD". Returns NaN if no number found. */
function parsePaymentTermsDays(terms: string | null | undefined): number {
  if (!terms) return NaN;
  const digits = terms.replace(/\D+/g, "");
  return digits ? parseInt(digits, 10) : NaN;
}

export async function syncBill(purchaseOrderId: string): Promise<{ qboId: string; action: "create" | "update" }> {
  const admin = await createAdminClient();

  // Fetch PO
  const { data: po, error: poError } = await admin
    .from("purchase_orders")
    .select("*")
    .eq("id", purchaseOrderId)
    .single();
  if (poError || !po) throw new Error(`Purchase order not found: ${purchaseOrderId}`);

  // Ensure supplier is synced first
  if (!po.supplier_id) throw new Error("PO has no supplier");

  let supplierMapping = await getMapping("supplier", po.supplier_id);
  if (!supplierMapping) {
    await syncSupplier(po.supplier_id);
    supplierMapping = await getMapping("supplier", po.supplier_id);
  }
  if (!supplierMapping) throw new Error("Failed to sync supplier to QBO");

  // Get default COGS account mapping
  const { data: cogsMapping } = await admin
    .from("qbo_account_mappings")
    .select("qbo_account_id")
    .eq("category", "cogs")
    .maybeSingle();

  if (!cogsMapping?.qbo_account_id) {
    throw new Error(
      "No QBO account mapping found for category 'cogs'. Configure account mappings in Settings > Integrations > QuickBooks."
    );
  }
  const accountRef = { value: cogsMapping.qbo_account_id };

  // Fetch PO line items. A failed READ must throw here: treating it as
  // "no items" used to fall through to the shipping-only branch below and
  // create a Bill with the entire COGS omitted (audit SF-3).
  const { data: lineItems, error: lineItemsError } = await admin
    .from("po_line_items")
    .select("*")
    .eq("purchase_order_id", purchaseOrderId);
  if (lineItemsError) {
    throw new Error(
      `Failed to read line items for purchase order ${po.po_number || purchaseOrderId}: ${lineItemsError.message}`
    );
  }

  // Build bill lines
  const lines: QBOBillLine[] = (lineItems || []).map((item) => ({
    Amount: item.quantity * Number(item.unit_price || 0),
    Description: `${item.catalog_type} - ${item.catalog_id}`,
    DetailType: "AccountBasedExpenseLineDetail" as const,
    AccountBasedExpenseLineDetail: {
      AccountRef: accountRef,
    },
  }));

  if (!lines.length && !Number(po.shipping_cost || 0)) {
    throw new Error(
      `Purchase order ${po.po_number || purchaseOrderId} has no line items. Cannot create an empty bill in QuickBooks.`
    );
  }

  // Add shipping cost as extra line if present. Shipping falls back to the
  // COGS account either way, but a failed lookup and a genuinely
  // unconfigured mapping log distinct warnings (audit SF-7) — the Bill total
  // stays right; only the P&L categorization diverges.
  const shippingCost = Number(po.shipping_cost || 0);
  if (shippingCost > 0) {
    const { data: shippingMapping, error: shippingMappingError } = await admin
      .from("qbo_account_mappings")
      .select("qbo_account_id")
      .eq("category", "shipping")
      .maybeSingle();
    if (shippingMappingError) {
      logger.warn(
        { err: shippingMappingError.message, purchaseOrderId },
        "QBO sync: failed to read 'shipping' account mapping; posting shipping to the COGS account"
      );
    } else if (!shippingMapping?.qbo_account_id) {
      logger.warn(
        { purchaseOrderId },
        "QBO sync: no 'shipping' account mapping configured; posting shipping to the COGS account"
      );
    }

    lines.push({
      Amount: shippingCost,
      Description: "Shipping",
      DetailType: "AccountBasedExpenseLineDetail",
      AccountBasedExpenseLineDetail: {
        AccountRef: shippingMapping?.qbo_account_id
          ? { value: shippingMapping.qbo_account_id }
          : accountRef,
      },
    });
  }

  // Get supplier for payment terms. A failed read falls back to the default
  // terms (due-date only), but is logged so the divergence is observable
  // (audit SF-11).
  const { data: supplier, error: supplierError } = await admin
    .from("suppliers")
    .select("payment_terms")
    .eq("id", po.supplier_id)
    .single();
  if (supplierError) {
    logger.warn(
      { err: supplierError.message, supplierId: po.supplier_id, purchaseOrderId },
      "QBO sync: failed to read supplier payment terms; falling back to default terms"
    );
  }

  const parsedDays = parsePaymentTermsDays(supplier?.payment_terms);
  const paymentTermsDays = parsedDays > 0 ? parsedDays : await getDefaultPaymentTermsDays();

  // Create-vs-update decision — a failed mapping read throws (recorded as a
  // failed sync-log row) rather than falling through to "create", which
  // would post a duplicate Bill into QuickBooks (audit SF-2).
  const existing = await getMappingOrLogFailure("purchase_order", purchaseOrderId);
  const action = existing ? "update" : "create";

  const txnDate = (po.order_date || new Date().toISOString()).split("T")[0];
  const qboBill: QBOBill = {
    DocNumber: po.po_number,
    VendorRef: { value: supplierMapping.qbo_entity_id },
    TxnDate: txnDate,
    DueDate: addDays(txnDate, paymentTermsDays),
    Line: lines,
  };
  const requestId = existing ? null : createQBORequestId("Bill", purchaseOrderId);

  // Persist the exact create intent before calling QuickBooks. Combined with
  // the stable request ID, this is the durable recovery record when the remote
  // call succeeds but its response or the local mapping write is lost.
  const logId = await createSyncLog("purchase_order", purchaseOrderId, action, {
    qboEntityType: "Bill",
    requestId,
    payload: qboBill,
  });
  let result: QBOEntityResponse<QBOBill> | undefined;

  try {
    if (existing) {
      const current = await qboClient.get<QBOEntityResponse<QBOBill>>(
        `/bill/${existing.qbo_entity_id}`
      );
      qboBill.Id = existing.qbo_entity_id;
      qboBill.SyncToken = current.Bill.SyncToken;
      qboBill.sparse = true;
      result = await qboClient.post<QBOEntityResponse<QBOBill>>("/bill", qboBill);
    } else {
      result = await qboClient.post<QBOEntityResponse<QBOBill>>(
        `/bill?requestid=${encodeURIComponent(requestId!)}`,
        qboBill
      );
    }

    const qboId = result.Bill.Id!;
    try {
      await upsertMapping("purchase_order", purchaseOrderId, "Bill", qboId);
    } catch (mappingError) {
      throw reconciliationRequiredError("Bill", qboId, mappingError);
    }
    await updateSyncLog(logId, "success", result);
    return { qboId, action };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await updateSyncLog(logId, "error", result, message);
    } catch (logError) {
      const logMessage = logError instanceof Error ? logError.message : String(logError);
      throw new Error(`${message} Additionally, ${logMessage}`, { cause: err });
    }
    throw err;
  }
}
