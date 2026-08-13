import { createAdminClient } from "@/lib/supabase/server";
import { qboClient } from "./client";
import { getMapping, upsertMapping, createSyncLog, updateSyncLog } from "./sync-utils";
import type { QBOVendor, QBOEntityResponse, QBOQueryResponse } from "./types";

/** Query QBO for an existing vendor by DisplayName. Returns the QBO Id if found. */
async function findExistingQBOVendor(displayName: string): Promise<string | null> {
  const escaped = displayName.replace(/'/g, "''");
  const response = await qboClient.query<QBOQueryResponse<QBOVendor>>(
    "Vendor",
    `DisplayName = '${escaped}'`
  );
  const vendors = response.QueryResponse.Vendor as QBOVendor[] | undefined;
  return vendors?.[0]?.Id ?? null;
}

/** Fetch the current QBO vendor, merge SyncToken, and do a sparse update. */
async function sparseUpdateVendor(
  qboId: string,
  payload: QBOVendor
): Promise<QBOEntityResponse<QBOVendor>> {
  const current = await qboClient.get<QBOEntityResponse<QBOVendor>>(
    `/vendor/${qboId}`
  );
  return qboClient.post<QBOEntityResponse<QBOVendor>>("/vendor", {
    ...payload,
    Id: qboId,
    SyncToken: current.Vendor.SyncToken,
    sparse: true,
  });
}

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
  // Placeholder based only on the local mapping — the name-match lookup below
  // can still resolve to an update even when this says "create". Corrected
  // before the sync log is closed out and before it is returned to the caller.
  const logId = await createSyncLog("supplier", supplierId, existing ? "update" : "create");

  try {
    const qboVendor: QBOVendor = {
      DisplayName: supplier.name,
      CompanyName: supplier.name,
      PrimaryEmailAddr: supplier.contact_email ? { Address: supplier.contact_email } : undefined,
      PrimaryPhone: supplier.contact_phone ? { FreeFormNumber: supplier.contact_phone } : undefined,
    };

    // Resolve the QBO ID: existing mapping, name match, or create new
    const existingQboId = existing?.qbo_entity_id ?? await findExistingQBOVendor(supplier.name);
    const action: "create" | "update" = existingQboId ? "update" : "create";

    const result = existingQboId
      ? await sparseUpdateVendor(existingQboId, qboVendor)
      : await qboClient.post<QBOEntityResponse<QBOVendor>>("/vendor", qboVendor);

    const qboId = result.Vendor.Id!;
    await upsertMapping("supplier", supplierId, "Vendor", qboId);
    await updateSyncLog(logId, "success", result, undefined, action);
    return { qboId, action };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateSyncLog(logId, "error", undefined, message);
    throw err;
  }
}
