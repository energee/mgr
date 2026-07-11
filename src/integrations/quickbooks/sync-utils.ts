import { createAdminClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import type { Json } from "@/types/supabase";
import type { SyncEntityType, QBOEntityType, SyncAction, SyncMapping, QBOAddress } from "./types";

/**
 * Look up the QBO mapping for an entity. Returns null only when the entity
 * has genuinely never been synced. A failed READ throws instead — callers use
 * null to mean "create a new QBO document", so conflating a transient DB
 * error with "no mapping" posts a duplicate Bill/Invoice/Vendor/Customer into
 * QuickBooks (audit SF-2; same bug class that duplicated the Square catalog).
 */
export async function getMapping(
  entityType: SyncEntityType,
  entityId: string
): Promise<SyncMapping | null> {
  const admin = await createAdminClient();
  const { data, error } = await admin
    .from("qbo_sync_mappings")
    .select("*")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `Failed to read QBO sync mapping for ${entityType} ${entityId}: ${error.message}`
    );
  }
  return data as SyncMapping | null;
}

/**
 * getMapping for the create-vs-update decision point of document syncs
 * (Bill/Invoice): a failed mapping read is additionally recorded as a failed
 * attempt in qbo_sync_log before rethrowing, so the aborted sync is visible
 * (and retryable) in the sync-log UI instead of only in the HTTP response.
 */
export async function getMappingOrLogFailure(
  entityType: SyncEntityType,
  entityId: string
): Promise<SyncMapping | null> {
  try {
    return await getMapping(entityType, entityId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      // action "create" is a placeholder: the sync aborted before
      // create-vs-update was known, and nothing was posted to QBO — the
      // error_message says so. A retry from this row re-runs the full sync.
      const logId = await createSyncLog(entityType, entityId, "create");
      await updateSyncLog(logId, "error", undefined, message);
    } catch (logErr) {
      // Best-effort: if the DB is down, logging the failure fails too —
      // never let that mask the original read error.
      logger.warn(
        { entityType, entityId, err: logErr instanceof Error ? logErr.message : String(logErr) },
        "QBO sync: could not record failed mapping lookup in qbo_sync_log"
      );
    }
    throw err;
  }
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

/**
 * Default payment-terms days from system_settings, falling back to 30 when
 * the setting is absent. Uses maybeSingle so a genuinely missing row (normal
 * for installs that never set it) is distinguished from a failed READ, which
 * also falls back but logs the divergence (audit SF-11 — due-date only, so a
 * logged fallback beats aborting the sync).
 */
export async function getDefaultPaymentTermsDays(): Promise<number> {
  const admin = await createAdminClient();
  const { data, error } = await admin
    .from("system_settings")
    .select("value")
    .eq("key", "default_payment_terms_days")
    .maybeSingle();
  if (error) {
    logger.warn(
      { err: error.message },
      "QBO sync: failed to read system_settings.default_payment_terms_days; defaulting to 30 days"
    );
  }
  return parseInt(String(data?.value ?? "30"), 10);
}
