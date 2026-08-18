"use client";

/**
 * EntityDeleteDialog — confirmation dialogs for entity delete actions.
 *
 * Two variants share this module:
 * - EntityDeleteDialog: single record (row menu / detail page), hard DELETE
 *   or soft deactivate (is_active=false) per the action's deleteMode.
 * - EntityBulkDeleteDialog: the selected-rows variant opened from the bulk
 *   action bar. Hard deletes attempt one bulk DELETE first and fall back to
 *   per-row DELETEs when it fails, so deletable rows still go away and each
 *   blocked row (e.g. FK-referenced) is reported individually inside the
 *   dialog (executeBulkDelete).
 */

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { createClient } from "@/lib/supabase/client";
import { parseUnknownError, PG_ERROR_CODES } from "@/lib/errors";
import { dynamicFrom } from "@/services/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

type EntityDeleteDialogProps = {
  entityTable: string;
  entityDisplayName: string;
  recordId: string;
  recordTitle: string;
  deleteMode: "hard" | "soft";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function EntityDeleteDialog({
  entityTable,
  entityDisplayName,
  recordId,
  recordTitle,
  deleteMode,
  open,
  onOpenChange,
  onSuccess,
}: EntityDeleteDialogProps) {
  const supabase = createClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isSoft = deleteMode === "soft";
  const verb = isSoft ? "Deactivate" : "Delete";
  const verbing = isSoft ? "Deactivating..." : "Deleting...";

  const loadingIdRef = useRef<string | number | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      loadingIdRef.current = toast.loading(verbing);
      // tx-ok: every path issues at most one write per record and rows are
      // independent by design — the single dialog does one UPDATE or DELETE,
      // bulk soft is one bulk UPDATE, and bulk hard is one bulk DELETE whose
      // per-row fallback (executeBulkDelete) intentionally lets each row
      // succeed or fail alone, reporting failures per-row for retry.
      const result = isSoft
        ? await dynamicFrom(supabase, entityTable)
            .update({ is_active: false } as Record<string, unknown>)
            .eq("id", recordId)
        : await dynamicFrom(supabase, entityTable)
            .delete()
            .eq("id", recordId);
      if (result.error) throw result.error;
    },
    onSuccess: () => {
      if (loadingIdRef.current !== null) toast.dismiss(loadingIdRef.current);
      const pastVerb = isSoft ? "deactivated" : "deleted";
      toast.success(`${entityDisplayName} "${recordTitle}" ${pastVerb}`);
      onOpenChange(false);
      onSuccess();
    },
    onError: (err: unknown) => {
      if (loadingIdRef.current !== null) toast.dismiss(loadingIdRef.current);
      const pgError = err as { code?: string; message?: string };
      if (pgError.code === PG_ERROR_CODES.FOREIGN_KEY_VIOLATION) {
        // Keep the entity-specific phrasing over the generic FK message
        setErrorMessage(
          `Cannot delete — this ${entityDisplayName.toLowerCase()} is referenced by other records.`
        );
      } else {
        // Friendly translation of other DB errors — RLS, check constraints
        // (src/lib/errors.ts)
        setErrorMessage(parseUnknownError(err).message);
      }
    },
  });

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setErrorMessage(null);
        onOpenChange(next);
      }}
    >
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {verb} {entityDisplayName.toLowerCase()}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isSoft
              ? `This will deactivate "${recordTitle}". It will be hidden from lists and dropdowns but preserved for historical records.`
              : `This will permanently delete "${recordTitle}". This action cannot be undone.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel variant="outline" disabled={mutation.isPending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? verbing : verb}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// =============================================================================
// Bulk delete
// =============================================================================

/** A record offered for bulk deletion: id plus a human-readable title. */
export type BulkDeleteRecord = { id: string; title: string };

/** One record that could not be deleted, with a user-facing reason. */
export type BulkDeleteFailure = BulkDeleteRecord & { reason: string };

export type BulkDeleteResult = {
  deletedIds: string[];
  failures: BulkDeleteFailure[];
};

/**
 * Delete (soft or hard) many records with per-row failure reporting.
 *
 * - soft: one bulk UPDATE setting is_active=false — all-or-nothing, a
 *   failure reports every record with the same reason.
 * - hard: one bulk DELETE first (happy path = a single request). A failure
 *   aborts the whole statement (e.g. one FK-referenced row), so it falls
 *   back to per-row DELETEs: deletable rows still go away and each blocked
 *   row gets its own failure entry.
 *
 * Exported for tests and never throws on PostgREST errors — they are folded
 * into `failures`.
 */
export async function executeBulkDelete(
  supabase: SupabaseClient<Database>,
  entityTable: string,
  entityDisplayName: string,
  records: BulkDeleteRecord[],
  deleteMode: "hard" | "soft"
): Promise<BulkDeleteResult> {
  const ids = records.map((r) => r.id);

  const failureReason = (err: unknown): string => {
    const pgError = err as { code?: string };
    return pgError?.code === PG_ERROR_CODES.FOREIGN_KEY_VIOLATION
      ? // Keep the entity-specific phrasing over the generic FK message
        `referenced by other records — this ${entityDisplayName.toLowerCase()} cannot be deleted`
      : parseUnknownError(err).message;
  };

  if (deleteMode === "soft") {
    const { error } = await dynamicFrom(supabase, entityTable)
      .update({ is_active: false } as Record<string, unknown>)
      .in("id", ids);
    if (error) {
      const reason = failureReason(error);
      return { deletedIds: [], failures: records.map((r) => ({ ...r, reason })) };
    }
    return { deletedIds: ids, failures: [] };
  }

  // Hard delete — bulk attempt first
  const { error: bulkError } = await dynamicFrom(supabase, entityTable)
    .delete()
    .in("id", ids);
  if (!bulkError) return { deletedIds: ids, failures: [] };

  // Per-row fallback: sequential so one slow/failing row can't stampede the
  // API, and each failure keeps its own reason
  const deletedIds: string[] = [];
  const failures: BulkDeleteFailure[] = [];
  for (const record of records) {
    const { error } = await dynamicFrom(supabase, entityTable)
      .delete()
      .eq("id", record.id);
    if (error) failures.push({ ...record, reason: failureReason(error) });
    else deletedIds.push(record.id);
  }
  return { deletedIds, failures };
}

type EntityBulkDeleteDialogProps = {
  entityTable: string;
  entityDisplayName: string;
  entityDisplayNamePlural: string;
  /** Records to delete; the parent shrinks this as rows succeed (selection
   *  sync), so a retry after partial failure only retries the failed rows. */
  records: BulkDeleteRecord[];
  deleteMode: "hard" | "soft";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ids actually removed — fires on partial success too, so the parent can
   *  refresh the list and drop the deleted ids from the selection. */
  onDeleted: (deletedIds: string[]) => void;
}

/**
 * Multi-record delete confirmation, opened from the bulk action bar.
 * On partial failure the dialog stays open listing each blocked record with
 * its reason; succeeded rows are already reported via onDeleted.
 */
export function EntityBulkDeleteDialog({
  entityTable,
  entityDisplayName,
  entityDisplayNamePlural,
  records,
  deleteMode,
  open,
  onOpenChange,
  onDeleted,
}: EntityBulkDeleteDialogProps) {
  const supabase = createClient();
  const [failures, setFailures] = useState<BulkDeleteFailure[]>([]);
  const isSoft = deleteMode === "soft";
  const verb = isSoft ? "Deactivate" : "Delete";
  const verbing = isSoft ? "Deactivating..." : "Deleting...";
  const pastVerb = isSoft ? "deactivated" : "deleted";
  const noun = (n: number) =>
    n === 1
      ? entityDisplayName.toLowerCase()
      : entityDisplayNamePlural.toLowerCase();

  const loadingIdRef = useRef<string | number | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      loadingIdRef.current = toast.loading(verbing);
      return executeBulkDelete(
        supabase,
        entityTable,
        entityDisplayName,
        records,
        deleteMode
      );
    },
    onSuccess: (result) => {
      if (loadingIdRef.current !== null) toast.dismiss(loadingIdRef.current);
      if (result.deletedIds.length > 0) onDeleted(result.deletedIds);
      if (result.failures.length === 0) {
        toast.success(
          `${result.deletedIds.length} ${noun(result.deletedIds.length)} ${pastVerb}`
        );
        setFailures([]);
        onOpenChange(false);
        return;
      }
      // Partial (or total) failure: keep the dialog open with per-row reasons
      setFailures(result.failures);
      if (result.deletedIds.length > 0) {
        toast.warning(
          `${result.deletedIds.length} ${pastVerb}, ${result.failures.length} failed`
        );
      }
    },
    onError: (err: unknown) => {
      // Unexpected (non-PostgREST) failure — executeBulkDelete folds DB
      // errors into the result, so this is network-level or a bug
      if (loadingIdRef.current !== null) toast.dismiss(loadingIdRef.current);
      toast.error(parseUnknownError(err).message);
    },
  });

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setFailures([]);
        onOpenChange(next);
      }}
    >
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {verb} {records.length} {noun(records.length)}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isSoft
              ? `This will deactivate ${records.length} ${noun(records.length)}. They will be hidden from lists and dropdowns but preserved for historical records.`
              : `This will permanently delete ${records.length} ${noun(records.length)}. This action cannot be undone.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {failures.length > 0 && (
          <div className="max-h-40 space-y-1 overflow-y-auto text-sm text-destructive">
            <p className="font-medium">
              {failures.length} could not be {pastVerb}:
            </p>
            <ul className="list-disc space-y-0.5 pl-5">
              {failures.map((f) => (
                <li key={f.id}>
                  <span className="font-medium">{f.title}</span> — {f.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel variant="outline" disabled={mutation.isPending}>
            {failures.length > 0 ? "Close" : "Cancel"}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
            disabled={mutation.isPending || records.length === 0}
          >
            {mutation.isPending
              ? verbing
              : failures.length > 0
                ? `Retry ${records.length}`
                : verb}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
