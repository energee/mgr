import { createAdminClient } from "@/lib/supabase/server";
import { qboClient } from "./client";
import { getMapping, upsertMapping, createSyncLog, updateSyncLog, mapAddress } from "./sync-utils";
import type { QBOCustomer, QBOEntityResponse } from "./types";

export async function syncCustomer(customerId: string): Promise<{ qboId: string; action: "create" | "update" }> {
  const admin = await createAdminClient();

  // Fetch MGR customer
  const { data: customer, error } = await admin
    .from("customers")
    .select("*")
    .eq("id", customerId)
    .single();
  if (error || !customer) throw new Error(`Customer not found: ${customerId}`);
  if (!customer.name?.trim()) {
    throw new Error(`Customer ${customerId} has no name. A display name is required to sync to QuickBooks.`);
  }

  const existing = await getMapping("customer", customerId);
  const action = existing ? "update" : "create";
  const logId = await createSyncLog("customer", customerId, action);

  try {
    const qboCustomer: QBOCustomer = {
      DisplayName: customer.name,
      CompanyName: customer.name,
      PrimaryEmailAddr: customer.email ? { Address: customer.email } : undefined,
      PrimaryPhone: customer.phone ? { FreeFormNumber: customer.phone } : undefined,
      BillAddr: mapAddress(customer.address),
      Taxable: !(customer as Record<string, unknown>).is_tax_exempt,
    };

    let result: QBOEntityResponse<QBOCustomer>;

    if (existing) {
      // Fetch current QBO Customer to get SyncToken
      const current = await qboClient.get<QBOEntityResponse<QBOCustomer>>(
        `/customer/${existing.qbo_entity_id}`
      );
      qboCustomer.Id = existing.qbo_entity_id;
      qboCustomer.SyncToken = current.Customer.SyncToken;
      qboCustomer.sparse = true;
      result = await qboClient.post<QBOEntityResponse<QBOCustomer>>(
        "/customer",
        qboCustomer
      );
    } else {
      result = await qboClient.post<QBOEntityResponse<QBOCustomer>>(
        "/customer",
        qboCustomer
      );
    }

    const qboId = result.Customer.Id!;
    await upsertMapping("customer", customerId, "Customer", qboId);
    await updateSyncLog(logId, "success", result);
    return { qboId, action };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateSyncLog(logId, "error", undefined, message);
    throw err;
  }
}
