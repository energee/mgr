import { createAdminClient } from "@/lib/supabase/server";
import { qboClient } from "./client";
import { getMapping, upsertMapping, createSyncLog, updateSyncLog, mapAddress } from "./sync-utils";
import type { QBOCustomer, QBOEntityResponse, QBOQueryResponse } from "./types";

/** Query QBO for an existing customer by DisplayName. Returns the QBO Id if found. */
async function findExistingQBOCustomer(displayName: string): Promise<string | null> {
  const escaped = displayName.replace(/'/g, "''");
  const response = await qboClient.query<QBOQueryResponse<QBOCustomer>>(
    "Customer",
    `DisplayName = '${escaped}'`
  );
  const customers = response.QueryResponse.Customer as QBOCustomer[] | undefined;
  return customers?.[0]?.Id ?? null;
}

/** Fetch the current QBO customer, merge SyncToken, and do a sparse update. */
async function sparseUpdateCustomer(
  qboId: string,
  payload: QBOCustomer
): Promise<QBOEntityResponse<QBOCustomer>> {
  const current = await qboClient.get<QBOEntityResponse<QBOCustomer>>(
    `/customer/${qboId}`
  );
  return qboClient.post<QBOEntityResponse<QBOCustomer>>("/customer", {
    ...payload,
    Id: qboId,
    SyncToken: current.Customer.SyncToken,
    sparse: true,
  });
}

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

    // Resolve the QBO ID: existing mapping, name match, or create new
    const existingQboId = existing?.qbo_entity_id ?? await findExistingQBOCustomer(customer.name);

    const result = existingQboId
      ? await sparseUpdateCustomer(existingQboId, qboCustomer)
      : await qboClient.post<QBOEntityResponse<QBOCustomer>>("/customer", qboCustomer);

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
