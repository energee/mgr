import { createAdminClient } from "@/lib/supabase/server";
import type { Json } from "@/types/supabase";
import type { SyncEntityType, QBOEntityType, SyncAction, SyncMapping, QBOAddress } from "./types";

export async function getMapping(
  entityType: SyncEntityType,
  entityId: string
): Promise<SyncMapping | null> {
  const admin = await createAdminClient();
  const { data } = await admin
    .from("qbo_sync_mappings")
    .select("*")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .maybeSingle();
  return data as SyncMapping | null;
}

export async function upsertMapping(
  entityType: SyncEntityType,
  entityId: string,
  qboEntityType: QBOEntityType,
  qboEntityId: string
): Promise<void> {
  const admin = await createAdminClient();
  await admin.from("qbo_sync_mappings").upsert(
    {
      entity_type: entityType,
      entity_id: entityId,
      qbo_entity_type: qboEntityType,
      qbo_entity_id: qboEntityId,
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: "entity_type,entity_id" }
  );
}

export async function createSyncLog(
  entityType: SyncEntityType,
  entityId: string,
  action: SyncAction,
  requestPayload?: unknown
): Promise<string> {
  const admin = await createAdminClient();
  const { data, error } = await admin
    .from("qbo_sync_log")
    .insert({
      entity_type: entityType,
      entity_id: entityId,
      action,
      status: "pending",
      request_payload: (requestPayload ?? null) as Json,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to create sync log: ${error.message}`);
  return data.id;
}

export async function updateSyncLog(
  logId: string,
  status: "success" | "error",
  responsePayload?: unknown,
  errorMessage?: string
): Promise<void> {
  const admin = await createAdminClient();
  await admin
    .from("qbo_sync_log")
    .update({
      status,
      response_payload: (responsePayload ?? null) as Json,
      error_message: errorMessage ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", logId);
}

// Address mapping helper: MGR address JSONB -> QBO Address
export function mapAddress(address: unknown): QBOAddress | undefined {
  if (!address || typeof address !== "object") return undefined;
  const addr = address as Record<string, string>;
  return {
    Line1: addr.street || addr.line1 || addr.address1 || undefined,
    Line2: addr.line2 || addr.address2 || undefined,
    City: addr.city || undefined,
    CountrySubDivisionCode: addr.state || addr.region || undefined,
    PostalCode: addr.zip || addr.postal_code || addr.postalCode || undefined,
    Country: addr.country || undefined,
  };
}

export async function getDefaultPaymentTermsDays(): Promise<number> {
  const admin = await createAdminClient();
  const { data } = await admin
    .from("system_settings")
    .select("value")
    .eq("key", "default_payment_terms_days")
    .single();
  return parseInt(String(data?.value ?? "30"), 10);
}
