"use client";

/**
 * BatchCancellationInfo - Display termination details for cancelled/archived batches
 *
 * Shows termination reason, timestamp, who terminated, and notes.
 * Rendered when batch status is 'cancelled' or 'archived'.
 *
 * - Cancelled: For planned batches that never started
 * - Archived: For in-progress batches that were terminated (with loss)
 */

import { format } from "date-fns";
import { Archive, XCircle } from "lucide-react";

interface BatchCancellationInfoProps {
  data: {
    status?: string | null;
    // Cancellation fields (for planned batches)
    cancellation_reason?: string | null;
    cancellation_reason_display?: string | null;
    cancelled_at?: string | null;
    cancelled_by_name?: string | null;
    cancellation_notes?: string | null;
    // Archive fields (for in-progress batches)
    archive_reason?: string | null;
    archive_reason_display?: string | null;
    archived_at?: string | null;
    archived_by_name?: string | null;
    archive_notes?: string | null;
  };
}

export function BatchCancellationInfo({ data }: BatchCancellationInfoProps) {
  const isCancelled = data?.status === "cancelled";
  const isArchived = data?.status === "archived";

  // Only show for terminated batches
  if (!isCancelled && !isArchived) {
    return null;
  }

  const isArchiveDisplay = isArchived;
  const Icon = isArchiveDisplay ? Archive : XCircle;
  const title = isArchiveDisplay ? "Archive Details" : "Cancellation Details";
  const borderColor = isArchiveDisplay ? "border-destructive/20" : "border-muted";
  const bgColor = isArchiveDisplay ? "bg-destructive/5" : "bg-muted/30";

  // Get the appropriate fields based on status
  const reason = isArchiveDisplay
    ? (data.archive_reason_display || formatArchiveReason(data.archive_reason))
    : (data.cancellation_reason_display || formatCancelReason(data.cancellation_reason));
  const timestamp = isArchiveDisplay ? data.archived_at : data.cancelled_at;
  const byName = isArchiveDisplay ? data.archived_by_name : data.cancelled_by_name;
  const notes = isArchiveDisplay ? data.archive_notes : data.cancellation_notes;

  return (
    <div className={`rounded-lg border ${borderColor} ${bgColor} p-4 space-y-3`}>
      <div className={`flex items-center gap-2 ${isArchiveDisplay ? "text-destructive" : "text-muted-foreground"}`}>
        <Icon className="h-4 w-4" />
        <span className="font-medium">{title}</span>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Reason</dt>
          <dd className="font-medium">{reason || "Not specified"}</dd>
        </div>

        {timestamp && (
          <div>
            <dt className="text-muted-foreground">{isArchiveDisplay ? "Archived At" : "Cancelled At"}</dt>
            <dd className="font-medium">
              {format(new Date(timestamp), "PPp")}
            </dd>
          </div>
        )}

        {byName && (
          <div>
            <dt className="text-muted-foreground">{isArchiveDisplay ? "Archived By" : "Cancelled By"}</dt>
            <dd className="font-medium">{byName}</dd>
          </div>
        )}

        {notes && (
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Notes</dt>
            <dd className="mt-1">{notes}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function formatCancelReason(reason?: string | null): string {
  if (!reason) return "";

  const reasonMap: Record<string, string> = {
    scheduling: "Schedule Change",
    recipe_change: "Recipe Change",
    capacity: "Capacity Issue",
    other: "Other",
  };

  return reasonMap[reason] || reason;
}

function formatArchiveReason(reason?: string | null): string {
  if (!reason) return "";

  const reasonMap: Record<string, string> = {
    quality: "Quality Issue",
    equipment: "Equipment Failure",
    contamination: "Contamination",
    scheduling: "Scheduling Change",
    other: "Other",
  };

  return reasonMap[reason] || reason;
}
