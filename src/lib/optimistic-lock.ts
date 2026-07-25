/**
 * Optimistic Locking Utility
 *
 * Prevents concurrent modification conflicts by using version-based locking.
 * Records are only updated if the version hasn't changed since loading.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { dynamicFrom } from "@/services/types";

// =============================================================================
// Types
// =============================================================================

export type OptimisticLockResult<T> = {
  success: boolean;
  data?: T;
  error?: string;
  conflicted?: boolean;
}

export type VersionedRecord = {
  id: string;
  version: number;
}

// =============================================================================
// Update with Optimistic Lock
// =============================================================================

/**
 * Update a record with optimistic locking.
 *
 * The update will only succeed if the record's version matches the expected version.
 * If the version has changed (another user modified the record), the update fails.
 *
 * @example
 * ```typescript
 * const result = await updateWithOptimisticLock(
 *   supabase,
 *   'finished_goods',
 *   record.id,
 *   { quantity: newQuantity },
 *   record.version
 * );
 *
 * if (!result.success) {
 *   if (result.conflicted) {
 *     toast.error('Record was modified. Please refresh and try again.');
 *   } else {
 *     toast.error(result.error);
 *   }
 * }
 * ```
 */
export async function updateWithOptimisticLock<T extends VersionedRecord>(
  supabase: SupabaseClient<Database>,
  table: string,
  id: string,
  data: Partial<Omit<T, "id" | "version">>,
  currentVersion: number
): Promise<OptimisticLockResult<T>> {
  const { data: updated, error } = await dynamicFrom(supabase, table)
    .update({
      ...data,
      version: currentVersion + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("version", currentVersion)
    .select()
    .single();

  if (error) {
    return {
      success: false,
      error: error.message || "Failed to update record",
      conflicted: false,
    };
  }

  if (!updated) {
    // No rows updated - version mismatch (concurrent modification)
    return {
      success: false,
      error: "Record was modified by another user. Please refresh and try again.",
      conflicted: true,
    };
  }

  return {
    success: true,
    data: updated as T,
  };
}
