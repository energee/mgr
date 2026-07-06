"use client";

/**
 * Batch Loss Summary
 *
 * Per-batch loss accounting anchored to packaging as the source of truth:
 * produced wort (± blends) vs actual packaged volume, with the attributed /
 * unattributed split. Data comes from getBatchLossSummary — the same
 * identity the completion auto-reconciliation records, so this card and the
 * TTB ledger can never disagree. Shown on the batch detail page below the
 * packaging history; renders nothing for batches with no production baseline.
 */

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { batchKeys } from "@/lib/query-keys";
import { getBatchLossSummary } from "@/services/consumption-service";
import { formatServiceError } from "@/services/types";
import { UnitDisplay } from "@/components/ui/unit-input";
import { AlertTriangle } from "lucide-react";

export function BatchLossSummary({
  batchId,
  status,
}: {
  batchId: string;
  status: string | null;
}) {
  const supabase = createClient();

  const { data: summary } = useQuery({
    queryKey: batchKeys.lossSummary(batchId),
    queryFn: async () => {
      const result = await getBatchLossSummary(supabase, batchId);
      if (!result.success) throw new Error(formatServiceError(result.error));
      return result.data;
    },
    // Nothing brewed yet — no baseline to account against.
    enabled: status !== null && status !== "planned",
  });

  if (!summary || summary.baselineBbl <= 0) return null;

  // Total actual loss = baseline − packaged; the attributed portion is
  // already on the allocation ledger, the remainder is unattributed.
  const totalLossBbl = summary.baselineBbl - summary.packagedBbl;
  const lossPct = (totalLossBbl / summary.baselineBbl) * 100;
  const negative = totalLossBbl < 0;

  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b px-4 py-3">
        <h3 className="text-sm font-medium">
          Loss{" "}
          <span className="font-normal text-muted-foreground">
            (packaged vs produced wort)
          </span>
        </h3>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 px-4 py-3 text-sm sm:grid-cols-4">
        <div>
          <div className="text-muted-foreground">Produced wort</div>
          <UnitDisplay value={summary.baselineBbl} unitType="volume" />
          {(summary.blendInBbl > 0 || summary.blendOutBbl > 0) && (
            <div className="text-xs text-muted-foreground">incl. blends</div>
          )}
        </div>
        <div>
          <div className="text-muted-foreground">Packaged</div>
          <UnitDisplay value={summary.packagedBbl} unitType="volume" />
        </div>
        <div>
          <div className="text-muted-foreground">Actual loss</div>
          <span className={negative ? "text-amber-600" : undefined}>
            <UnitDisplay value={totalLossBbl} unitType="volume" />
          </span>
          {!negative && (
            <span className="ml-1 text-xs text-muted-foreground">
              ({lossPct.toFixed(1)}%)
            </span>
          )}
        </div>
        <div>
          <div className="text-muted-foreground">Attributed</div>
          <UnitDisplay value={summary.attributedBbl} unitType="volume" />
        </div>
      </div>
      {summary.hasOpenSessions && (
        <div className="border-t px-4 py-2 text-xs text-muted-foreground">
          Packaging in progress — loss is provisional until all sessions complete.
        </div>
      )}
      {negative && (
        <div className="flex items-center gap-2 border-t border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
          Packaged volume exceeds produced wort — check brew log volumes, blend
          records, or post-knockout additions.
        </div>
      )}
    </div>
  );
}
