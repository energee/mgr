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
      // Preserve both failures: the mapping read remains the primary cause,
      // while the audit-write failure must also reach the caller.
      const logMessage = logErr instanceof Error ? logErr.message : String(logErr);
      logger.warn(
        { entityType, entityId, err: logMessage },
        "QBO sync: could not record failed mapping lookup in qbo_sync_log"
      );
      throw new Error(`${message}. Additionally, ${logMessage}`, { cause: err });
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
  const { error } = await admin.from("qbo_sync_mappings").upsert(
    {
      entity_type: entityType,
      entity_id: entityId,
      qbo_entity_type: qboEntityType,
      qbo_entity_id: qboEntityId,
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: "entity_type,entity_id" }
  );
  if (error) {
    throw new Error(
      `Failed to persist QBO sync mapping for ${entityType} ${entityId} to ${qboEntityType} ${qboEntityId}: ${error.message}`
    );
  }
}

/**
 * Stable create identity sent to QuickBooks. Intuit limits request IDs to 50
 * characters and deduplicates writes per company file, which makes a retry
 * safe after a lost response or a failed local mapping write.
 *
 * Ceiling: Intuit's request-ID dedup is time-bounded, not indefinite. A retry
 * issued after that window has elapsed (e.g. re-running a stale failed
 * sync-log row days later) can create a second remote document. Retries close
 * to the original attempt — the common recovery case — are the safe path.
 */
export function createQBORequestId(
  qboEntityType: Extract<QBOEntityType, "Invoice" | "Bill">,
  entityId: string
): string {
  const discriminator = qboEntityType === "Invoice" ? "i" : "b";
  const requestId = `mgr-${discriminator}-${entityId}`;
  if (requestId.length > 50) {
    throw new Error(
      `Cannot build a QBO request ID for ${qboEntityType}: entity ID exceeds the 50-character request limit`
    );
  }
  return requestId;
}

/**
 * The external document exists but its local identity was not made durable.
 * The stable QuickBooks request ID lets the operator retry without creating a
 * second accounting document.
 */
export function reconciliationRequiredError(
  qboEntityType: Extract<QBOEntityType, "Invoice" | "Bill">,
  qboEntityId: string,
  mappingError: unknown
): Error {
  const detail = mappingError instanceof Error ? mappingError.message : String(mappingError);
  return new Error(
    `QuickBooks accepted ${qboEntityType} ${qboEntityId}, but MGR could not save its mapping. ` +
      `The remote document exists; retry sync to reconcile it safely. ${detail}`,
    { cause: mappingError }
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
  const { error } = await admin
    .from("qbo_sync_log")
    .update({
      status,
      response_payload: (responsePayload ?? null) as Json,
      error_message: errorMessage ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", logId);
  if (error) {
    throw new Error(`Failed to update QBO sync log ${logId}: ${error.message}`);
  }
}

/**
 * Close out a successful document sync. The remote document and its local
 * mapping are already durable by this point, so a failed audit-log write must
 * NOT turn a completed sync into a reported failure — log it loudly instead.
 */
export async function completeSyncLogSuccess(
  logId: string,
  responsePayload: unknown
): Promise<void> {
  try {
    await updateSyncLog(logId, "success", responsePayload);
  } catch (logError) {
    logger.warn(
      { logId, err: logError instanceof Error ? logError.message : String(logError) },
      "QBO sync: document created and mapped, but the success log write failed"
    );
  }
}

/**
 * Record a failed document sync in qbo_sync_log and rethrow. Preserves the
 * response payload (present when the remote create succeeded but a later local
 * write failed) and, if the audit-log write itself fails, surfaces both
 * failures rather than masking the primary one.
 */
export async function recordSyncFailure(
  logId: string,
  responsePayload: unknown,
  err: unknown
): Promise<never> {
  const message = err instanceof Error ? err.message : String(err);
  try {
    await updateSyncLog(logId, "error", responsePayload, message);
  } catch (logError) {
    const logMessage = logError instanceof Error ? logError.message : String(logError);
    throw new Error(`${message} Additionally, ${logMessage}`, { cause: err });
  }
  throw err;
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
