import { createAdminClient } from "@/lib/supabase/server";
import { qboClient } from "./client";
import { getMapping, upsertMapping, createSyncLog, updateSyncLog } from "./sync-utils";
import type { QBOVendor, QBOEntityResponse } from "./types";

export async function syncSupplier(supplierId: string): Promise<{ qboId: string; action: "create" | "update" }> {
  const admin = await createAdminClient();

  const { data: supplier, error } = await admin
    .from("suppliers")
    .select("*")
    .eq("id", supplierId)
    .single();
  if (error || !supplier) throw new Error(`Supplier not found: ${supplierId}`);
  if (!supplier.name?.trim()) {
    throw new Error(`Supplier ${supplierId} has no name. A display name is required to sync to QuickBooks.`);
  }

  const existing = await getMapping("supplier", supplierId);
  const action = existing ? "update" : "create";
  const logId = await createSyncLog("supplier", supplierId, action);

  try {
    const qboVendor: QBOVendor = {
      DisplayName: supplier.name,
      CompanyName: supplier.name,
      PrimaryEmailAddr: supplier.contact_email ? { Address: supplier.contact_email } : undefined,
      PrimaryPhone: supplier.contact_phone ? { FreeFormNumber: supplier.contact_phone } : undefined,
    };

    let result: QBOEntityResponse<QBOVendor>;

    if (existing) {
      const current = await qboClient.get<QBOEntityResponse<QBOVendor>>(
        `/vendor/${existing.qbo_entity_id}`
      );
      qboVendor.Id = existing.qbo_entity_id;
      qboVendor.SyncToken = current.Vendor.SyncToken;
      qboVendor.sparse = true;
      result = await qboClient.post<QBOEntityResponse<QBOVendor>>("/vendor", qboVendor);
    } else {
      result = await qboClient.post<QBOEntityResponse<QBOVendor>>("/vendor", qboVendor);
    }

    const qboId = result.Vendor.Id!;
    await upsertMapping("supplier", supplierId, "Vendor", qboId);
    await updateSyncLog(logId, "success", result);
    return { qboId, action };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateSyncLog(logId, "error", undefined, message);
    throw err;
  }
}
