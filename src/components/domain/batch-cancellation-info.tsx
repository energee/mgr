"use client";

/**
 * BatchCancellationInfo - Display cancellation details for a cancelled batch
 *
 * Shows cancellation reason, timestamp, who cancelled, and notes.
 * Only rendered when batch status is 'cancelled'.
 */

import { format } from "date-fns";
import { AlertTriangle } from "lucide-react";

interface BatchCancellationInfoProps {
  data: {
    status?: string;
    cancellation_reason?: string;
    cancellation_reason_display?: string;
    cancelled_at?: string;
    cancelled_by_name?: string;
    cancellation_notes?: string;
  };
}

export function BatchCancellationInfo({ data }: BatchCancellationInfoProps) {
  // Only show for cancelled batches
  if (data?.status !== "cancelled") {
    return null;
  }

  const reasonDisplay =
    data.cancellation_reason_display ||
    formatReason(data.cancellation_reason);

  return (
    <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 space-y-3">
      <div className="flex items-center gap-2 text-destructive">
        <AlertTriangle className="h-4 w-4" />
        <span className="font-medium">Cancellation Details</span>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Reason</dt>
          <dd className="font-medium">{reasonDisplay || "Not specified"}</dd>
        </div>

        {data.cancelled_at && (
          <div>
            <dt className="text-muted-foreground">Cancelled At</dt>
            <dd className="font-medium">
              {format(new Date(data.cancelled_at), "PPp")}
            </dd>
          </div>
        )}

        {data.cancelled_by_name && (
          <div>
            <dt className="text-muted-foreground">Cancelled By</dt>
            <dd className="font-medium">{data.cancelled_by_name}</dd>
          </div>
        )}

        {data.cancellation_notes && (
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Notes</dt>
            <dd className="mt-1">{data.cancellation_notes}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function formatReason(reason?: string): string {
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
