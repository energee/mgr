/**
 * VesselCurrentBatch Component
 *
 * Displays the current batch information for a vessel.
 * Used in vessel detail view's "Current Batch" section.
 */

import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { StatusBadge } from "@/components/universal/status-badge";
import { batchEntity } from "@/entities/batch";

interface VesselWithBatchData {
  current_batch_id?: string | null;
  batch_number?: string | null;
  batch_name?: string | null;
  batch_status?: string | null;
  recipe_name?: string | null;
}

interface VesselCurrentBatchProps {
  data: VesselWithBatchData;
}

export function VesselCurrentBatch({ data }: VesselCurrentBatchProps) {
  if (!data.current_batch_id) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground">
        <FlaskConical className="h-5 w-5 mr-2 opacity-50" />
        <span>No batch currently in this vessel</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Link
          href={`/production/batches/${data.current_batch_id}`}
          className="text-lg font-semibold hover:underline"
        >
          {data.batch_number || data.batch_name || "View Batch"}
        </Link>
        {data.batch_status && (
          <StatusBadge
            status={data.batch_status}
            config={batchEntity.stateMachine?.stateDisplay}
          />
        )}
      </div>
      {data.recipe_name && (
        <div className="text-sm text-muted-foreground">
          Recipe: {data.recipe_name}
        </div>
      )}
    </div>
  );
}
