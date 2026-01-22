/**
 * VesselCurrentBatch Component
 *
 * Displays the current batch information for a vessel.
 * Used in vessel detail view's "Current Batch" section.
 */

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { FlaskConical } from "lucide-react";

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

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  planned: { label: "Planned", variant: "secondary" },
  fermenting: { label: "Fermenting", variant: "default" },
  conditioning: { label: "Conditioning", variant: "default" },
  packaging: { label: "Packaging", variant: "outline" },
  completed: { label: "Completed", variant: "secondary" },
};

export function VesselCurrentBatch({ data }: VesselCurrentBatchProps) {
  if (!data.current_batch_id) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground">
        <FlaskConical className="h-5 w-5 mr-2 opacity-50" />
        <span>No batch currently in this vessel</span>
      </div>
    );
  }

  const status = statusConfig[data.batch_status || ""] || { label: data.batch_status, variant: "outline" as const };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Link
          href={`/production/batches/${data.current_batch_id}`}
          className="text-lg font-semibold hover:underline"
        >
          {data.batch_number || data.batch_name || "View Batch"}
        </Link>
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>
      {data.recipe_name && (
        <div className="text-sm text-muted-foreground">
          Recipe: {data.recipe_name}
        </div>
      )}
    </div>
  );
}
