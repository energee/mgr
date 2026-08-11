import { createAdminClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { qboClient } from "./client";
import {
  getMapping,
  getMappingOrLogFailure,
  upsertMapping,
  createSyncLog,
  completeSyncLogSuccess,
  recordSyncFailure,
  getDefaultPaymentTermsDays,
  createQBORequestId,
  reconciliationRequiredError,
  addDays,
} from "./sync-utils";
import { syncSupplier } from "./sync-supplier";
import type { QBOBill, QBOBillLine, QBOEntityResponse } from "./types";

/** Extract numeric days from a payment terms string like "Net 30" or "COD". Returns NaN if no number found. */
function parsePaymentTermsDays(terms: string | null | undefined): number {
  if (!terms) return NaN;
  const digits = terms.replace(/\D+/g, "");
  return digits ? parseInt(digits, 10) : NaN;
}

/**
 * Resolves the QBO account mapped to `category` (e.g. "shipping", "tax"),
 * falling back to `fallbackAccountRef` when it's unconfigured or the read
 * fails — logging which case happened, since the two failure modes stay
 * observable in sync logs (audit SF-7). The Bill total is right either way;
 * only the P&L categorization diverges.
 */
async function resolveExtraCostAccount(
  admin: Awaited<ReturnType<typeof createAdminClient>>,
  category: string,
  fallbackAccountRef: { value: string },
  purchaseOrderId: string
): Promise<{ value: string }> {
  const { data: mapping, error } = await admin
    .from("qbo_account_mappings")
    .select("qbo_account_id")
    .eq("category", category)
    .maybeSingle();
  if (error) {
    logger.warn(
      { err: error.message, purchaseOrderId },
      `QBO sync: failed to read '${category}' account mapping; posting ${category} to the COGS account`
    );
  } else if (!mapping?.qbo_account_id) {
    logger.warn(
      { purchaseOrderId },
      `QBO sync: no '${category}' account mapping configured; posting ${category} to the COGS account`
    );
  }
  return mapping?.qbo_account_id ? { value: mapping.qbo_account_id } : fallbackAccountRef;
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

  const shippingCost = Number(po.shipping_cost || 0);
  const taxAmount = Number(po.tax || 0);

  if (!lines.length && !shippingCost && !taxAmount) {
    throw new Error(
      `Purchase order ${po.po_number || purchaseOrderId} has no line items. Cannot create an empty bill in QuickBooks.`
    );
  }

  // Post shipping and tax as their own lines rather than folding them into
  // COGS. `purchase_orders.tax` is a real vendor-payable amount (allocated
  // into per-unit landed cost elsewhere) — omitting it understates the Bill
  // total by exactly the tax amount, as this sync used to. Each falls back
  // to the COGS account per resolveExtraCostAccount (audit SF-7).
  const extraCosts = [
    { category: "shipping", description: "Shipping", amount: shippingCost },
    { category: "tax", description: "Tax", amount: taxAmount },
  ].filter((cost) => cost.amount > 0);

  const extraAccountRefs = await Promise.all(
    extraCosts.map((cost) => resolveExtraCostAccount(admin, cost.category, accountRef, purchaseOrderId))
  );
  extraCosts.forEach((cost, i) => {
    lines.push({
      Amount: cost.amount,
      Description: cost.description,
      DetailType: "AccountBasedExpenseLineDetail",
      AccountBasedExpenseLineDetail: { AccountRef: extraAccountRefs[i] },
    });
  });

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
  // The request ID is derived from the entity, not the payload. If a create
  // whose mapping write failed is retried after the purchase order is edited,
  // QuickBooks dedups on this ID and returns the original document; the edit
  // reaches QBO on the next (update) sync, not this retry.
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
    await completeSyncLogSuccess(logId, result);
    return { qboId, action };
  } catch (err) {
    return recordSyncFailure(logId, result, err);
  }
}
