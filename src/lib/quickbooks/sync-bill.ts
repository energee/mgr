import { createAdminClient } from "@/lib/supabase/server";
import { qboClient } from "./client";
import { getMapping, upsertMapping, createSyncLog, updateSyncLog, getDefaultPaymentTermsDays } from "./sync-utils";
import { syncSupplier } from "./sync-supplier";
import type { QBOBill, QBOBillLine, QBOEntityResponse } from "./types";

function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + days);
  return date.toISOString().split("T")[0];
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

  // Fetch PO line items
  const { data: lineItems } = await admin
    .from("po_line_items")
    .select("*")
    .eq("purchase_order_id", purchaseOrderId);

  // Build bill lines
  const lines: QBOBillLine[] = (lineItems || []).map((item) => ({
    Amount: Number(item.total_cost || item.quantity * (item.unit_cost || 0)),
    Description: item.description || item.item_name || "Line item",
    DetailType: "AccountBasedExpenseLineDetail" as const,
    AccountBasedExpenseLineDetail: {
      AccountRef: accountRef,
    },
  }));

  // Add shipping cost as extra line if present
  const shippingCost = Number(po.shipping_cost || 0);
  if (shippingCost > 0) {
    const { data: shippingMapping } = await admin
      .from("qbo_account_mappings")
      .select("qbo_account_id")
      .eq("category", "shipping")
      .maybeSingle();

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

  // Get supplier for payment terms
  const { data: supplier } = await admin
    .from("suppliers")
    .select("payment_terms")
    .eq("id", po.supplier_id)
    .single();

  const paymentTermsDays = (supplier as Record<string, unknown> | null)?.payment_terms as number | null
    ?? await getDefaultPaymentTermsDays();

  const existing = await getMapping("purchase_order", purchaseOrderId);
  const action = existing ? "update" : "create";
  const logId = await createSyncLog("purchase_order", purchaseOrderId, action);

  try {
    const txnDate = (po.order_date || new Date().toISOString()).split("T")[0];

    const qboBill: QBOBill = {
      DocNumber: po.po_number,
      VendorRef: { value: supplierMapping.qbo_entity_id },
      TxnDate: txnDate,
      DueDate: addDays(txnDate, paymentTermsDays),
      Line: lines,
    };

    let result: QBOEntityResponse<QBOBill>;

    if (existing) {
      const current = await qboClient.get<QBOEntityResponse<QBOBill>>(
        `/bill/${existing.qbo_entity_id}`
      );
      qboBill.Id = existing.qbo_entity_id;
      qboBill.SyncToken = current.Bill.SyncToken;
      qboBill.sparse = true;
      result = await qboClient.post<QBOEntityResponse<QBOBill>>("/bill", qboBill);
    } else {
      result = await qboClient.post<QBOEntityResponse<QBOBill>>("/bill", qboBill);
    }

    const qboId = result.Bill.Id!;
    await upsertMapping("purchase_order", purchaseOrderId, "Bill", qboId);
    await updateSyncLog(logId, "success", result);
    return { qboId, action };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateSyncLog(logId, "error", undefined, message);
    throw err;
  }
}
