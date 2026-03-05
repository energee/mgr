"use client";

/**
 * Yeast Pitch Detail Page
 *
 * View yeast pitch details including strain, viability, lineage, and usage.
 * Enhanced with:
 * - Viability decay chart showing projected viability over time
 * - Cost spreading summary from the yeast_lineage_summary view
 *
 * Handles custom actions:
 * - Record Cell Count: opens dialog to update viability from a lab measurement
 * - Pitch to Batch: redirects users to the batch detail page (batch-centric model)
 * - Discard: handled by the universal entity detail (state transition)
 */

import { use, useState, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { yeastPitchEntity } from "@/entities/yeast-pitch";
import { YeastLineageDisplay } from "@/components/domain/yeast-lineage-display";
import { YeastViabilityChart } from "@/components/domain/yeast-viability-chart";
import { RecordCellCountDialog } from "@/components/domain/record-cell-count-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";
import { yeastKeys, entityKeys } from "@/lib/query-keys";
import type { YeastForm } from "@/lib/yeast-calculations";
import { formatCurrency, formatDate } from "@/lib/format";

// =============================================================================
// Types
// =============================================================================

interface PitchDetail {
  id: string;
  strain_name: string | null;
  strain_form: string | null;
  source_type: string | null;
  initial_viability: number | null;
  received_date: string | null;
  harvest_date: string | null;
}

interface LineageSummary {
  root_id: string;
  strain_name: string | null;
  original_cost: number | null;
  total_pitches_in_lineage: number | null;
  batches_used: number | null;
  cost_per_batch: number | null;
  max_generations: number | null;
}

interface PitchEvent {
  id: string;
  batch_id: string;
  quantity_lbs: number | null;
  pitched_at: string | null;
  batch_name?: string | null;
}

// =============================================================================
// Page Component
// =============================================================================

interface YeastPitchDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function YeastPitchDetailPage({ params }: YeastPitchDetailPageProps) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const supabase = createClient();

  const [showCellCountDialog, setShowCellCountDialog] = useState(false);
  const [currentPitchData, setCurrentPitchData] = useState<{
    id: string;
    strain_name?: string;
    source_type?: string;
  } | null>(null);

  // Fetch pitch details for chart props
  const { data: pitchDetail } = useQuery({
    queryKey: yeastKeys.detail(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("yeast_pitches_with_remaining")
        .select(
          "id, strain_name, strain_form, source_type, initial_viability, received_date, harvest_date"
        )
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as PitchDetail;
    },
  });

  // Find the root pitch ID for lineage summary queries via server-side recursive CTE
  const { data: rootId } = useQuery({
    queryKey: yeastKeys.lineageRoot(id),
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)(
        "get_yeast_lineage_root",
        { p_pitch_id: id },
      ) as { data: string | null; error: Error | null };
      if (error) throw error;
      return data ?? id;
    },
  });

  // Fetch lineage summary for cost spreading
  const { data: lineageSummary, isLoading: lineageLoading } = useQuery({
    queryKey: yeastKeys.costSpread(id),
    queryFn: async () => {
      if (!rootId) return null;
      const { data, error } = await supabase
        .from("yeast_lineage_summary")
        .select("*")
        .eq("root_id", rootId)
        .single();
      if (error) throw error;
      return data as LineageSummary;
    },
    enabled: !!rootId,
  });

  // Fetch pitch events for chart markers and cost table
  const { data: pitchEvents } = useQuery({
    queryKey: yeastKeys.events(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("yeast_pitch_events")
        .select("id, batch_id, quantity_lbs, pitched_at")
        .eq("pitch_id", id)
        .order("pitched_at", { ascending: true });
      if (error) throw error;

      // Resolve batch names
      if (data && data.length > 0) {
        const batchIds = [...new Set(data.map((e) => e.batch_id).filter(Boolean))];
        if (batchIds.length > 0) {
          const { data: batches } = await supabase
            .from("batches")
            .select("id, name")
            .in("id", batchIds);

          const batchMap = new Map(batches?.map((b) => [b.id, b.name]) ?? []);
          return data.map((e) => ({
            ...e,
            batch_name: batchMap.get(e.batch_id) ?? null,
          })) as PitchEvent[];
        }
      }
      return (data ?? []) as PitchEvent[];
    },
  });

  // Chart pitch events in the format the chart expects
  const chartPitchEvents = useMemo(() => {
    if (!pitchEvents) return undefined;
    return pitchEvents
      .filter((e) => e.pitched_at)
      .map((e) => ({
        date: e.pitched_at!,
        quantity: Number(e.quantity_lbs ?? 0),
      }));
  }, [pitchEvents]);

  // Handle custom actions from the entity detail action bar.
  const handleAction = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (actionName: string, data: any): boolean => {
      if (actionName === "record_cell_count") {
        setCurrentPitchData({
          id: data.id,
          strain_name: data.strain_name,
          source_type: data.source_type,
        });
        setShowCellCountDialog(true);
        return true;
      }
      return false;
    },
    []
  );

  // Determine chart props
  const chartReceivedDate = pitchDetail?.harvest_date ?? pitchDetail?.received_date;
  const chartForm: YeastForm = (pitchDetail?.strain_form as YeastForm) ?? "liquid";
  const chartInitialViability = pitchDetail?.initial_viability ?? 95;

  return (
    <>
      <EntityDetailUnifiedWithErrorBoundary
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        entity={yeastPitchEntity as any}
        id={id}
        basePath="/production/yeast-pitches"
        onAction={handleAction}
      />

      {/* Viability Decay Chart */}
      {chartReceivedDate && (
        <div className="mt-6">
          <YeastViabilityChart
            initialViability={chartInitialViability}
            receivedDate={chartReceivedDate}
            form={chartForm}
            pitchEvents={chartPitchEvents}
          />
        </div>
      )}

      {/* Cost Spreading Summary */}
      <div className="mt-6">
        <CostSpreadingSummary
          lineageSummary={lineageSummary ?? null}
          pitchEvents={pitchEvents ?? []}
          isLoading={lineageLoading}
        />
      </div>

      {/* Lineage display */}
      <div className="mt-6">
        <YeastLineageDisplay pitchId={id} />
      </div>

      {/* Record Cell Count Dialog */}
      {currentPitchData && (
        <RecordCellCountDialog
          open={showCellCountDialog}
          onOpenChange={setShowCellCountDialog}
          pitchId={currentPitchData.id}
          pitchName={currentPitchData.strain_name || "this pitch"}
          sourceType={
            currentPitchData.source_type === "harvest" ? "harvest" : "purchase"
          }
          onSuccess={() => {
            queryClient.invalidateQueries({
              queryKey: yeastKeys.detail(id),
            });
            queryClient.invalidateQueries({
              queryKey: entityKeys.detail("yeast_pitches_with_remaining", id),
            });
          }}
        />
      )}
    </>
  );
}

// =============================================================================
// Cost Spreading Summary
// =============================================================================

function CostSpreadingSummary({
  lineageSummary,
  pitchEvents,
  isLoading,
}: {
  lineageSummary: LineageSummary | null;
  pitchEvents: PitchEvent[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!lineageSummary) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Cost Spreading</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Total Cost</p>
            <p className="text-lg font-semibold">
              {formatCurrency(lineageSummary.original_cost)}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Batches Used</p>
            <p className="text-lg font-semibold">
              {lineageSummary.batches_used ?? 0}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Cost Per Batch</p>
            <p className="text-lg font-semibold">
              {formatCurrency(lineageSummary.cost_per_batch)}
            </p>
          </div>
        </div>

        {/* Batch usage table */}
        {pitchEvents.length > 0 && (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch</TableHead>
                  <TableHead className="text-right">Qty (lbs)</TableHead>
                  <TableHead className="text-right">Date</TableHead>
                  <TableHead className="text-right">Alloc. Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pitchEvents.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="font-medium">
                      {event.batch_name || event.batch_id.slice(0, 8)}
                    </TableCell>
                    <TableCell className="text-right">
                      {event.quantity_lbs != null
                        ? Number(event.quantity_lbs).toFixed(1)
                        : "\u2014"}
                    </TableCell>
                    <TableCell className="text-right">
                      {event.pitched_at
                        ? formatDate(event.pitched_at)
                        : "\u2014"}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(lineageSummary.cost_per_batch)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
