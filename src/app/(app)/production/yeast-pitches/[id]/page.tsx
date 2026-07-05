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
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { EntityBreadcrumb } from "@/components/universal/entity-breadcrumb";
import { yeastPitchEntity } from "@/entities/yeast-pitch";
import type { EntityConfig } from "@/types/entity";
import { YeastLineageDisplay } from "@/components/domain/yeast/yeast-lineage-display";
import { RecordCellCountDialog } from "@/components/domain/yeast/record-cell-count-dialog";
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
import { resolveYeastLineageRoot } from "@/domain/yeast-lineage";
import { yeastKeys, entityKeys } from "@/lib/query-keys";
import { unwrap } from "@/lib/supabase/query-helpers";
import type { YeastForm } from "@/domain/yeast-calculations";
import { formatCurrency, formatDate } from "@/lib/format";

// Code-split the recharts-heavy viability chart off this page's initial
// bundle (mirrors the dashboard chart splits, audit F-142). It sits below the
// fold and only renders when a received date is present, so deferring it is a
// pure win. `ssr: false` because recharts measures the DOM on mount. The
// fallback mirrors the chart's Card chrome (280px canvas) to avoid CLS.
const YeastViabilityChart = dynamic(
  () =>
    import("@/components/domain/yeast/yeast-viability-chart").then(
      (mod) => mod.YeastViabilityChart,
    ),
  {
    ssr: false,
    loading: () => (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Viability Decay</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[280px] w-full" />
        </CardContent>
      </Card>
    ),
  },
);

// =============================================================================
// Types
// =============================================================================

type PitchDetail = {
  id: string;
  strain_name: string | null;
  strain_form: string | null;
  source_type: string | null;
  initial_viability: number | null;
  received_date: string | null;
  harvest_date: string | null;
}

type LineageSummary = {
  root_id: string;
  strain_name: string | null;
  original_cost: number | null;
  total_pitches_in_lineage: number | null;
  batches_used: number | null;
  cost_per_batch: number | null;
  max_generations: number | null;
}

type PitchEvent = {
  id: string;
  batch_id: string;
  quantity_lbs: number | null;
  pitched_at: string | null;
  batch_name?: string | null;
}

// =============================================================================
// Page Component
// =============================================================================

type YeastPitchDetailPageProps = {
  params: Promise<{ id: string }>;
}

export default function YeastPitchDetailPage({ params }: YeastPitchDetailPageProps) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const supabase = createClient();

  const router = useRouter();
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
      return await unwrap(
        supabase
          .from("yeast_pitches_with_remaining")
          .select(
            "id, strain_name, strain_form, source_type, initial_viability, received_date, harvest_date"
          )
          .eq("id", id)
          .single()
      ) as PitchDetail;
    },
  });

  // Find the root pitch ID for lineage summary. Tries RPC; falls back to parent walk.
  const { data: rootId } = useQuery({
    queryKey: yeastKeys.lineageRoot(id),
    queryFn: () => resolveYeastLineageRoot(supabase, id),
  });

  // Fetch lineage summary for cost spreading
  const { data: lineageSummary, isLoading: lineageLoading } = useQuery({
    queryKey: yeastKeys.lineageSummary(rootId),
    queryFn: async () => {
      if (!rootId) return null;
      return await unwrap(
        supabase
          .from("yeast_lineage_summary")
          .select("*")
          .eq("root_id", rootId)
          .single()
      ) as LineageSummary;
    },
    enabled: !!rootId,
  });

  // Fetch pitch events for chart markers and cost table
  const { data: pitchEvents } = useQuery({
    queryKey: yeastKeys.events(id),
    queryFn: async () => {
      const data = await unwrap(
        supabase
          .from("yeast_pitch_events")
          .select("id, batch_id, quantity_lbs, pitched_at")
          .eq("pitch_id", id)
          .order("pitched_at", { ascending: true })
      );

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
    (actionName: string, data: Record<string, unknown>): boolean => {
      if (actionName === "record_cell_count") {
        setCurrentPitchData({
          id: data.id as string,
          strain_name: data.strain_name as string | undefined,
          source_type: data.source_type as string | undefined,
        });
        setShowCellCountDialog(true);
        return true;
      }
      if (actionName === "pitch_to_batch") {
        toast.info("Yeast pitching is done from the batch detail page", {
          description: "Navigate to a batch and use the Yeast section to pitch.",
          action: {
            label: "Go to Batches",
            onClick: () => router.push("/production/batches"),
          },
        });
        return true;
      }
      return false;
    },
    [router]
  );

  // Determine chart props
  const chartReceivedDate = pitchDetail?.harvest_date ?? pitchDetail?.received_date;
  const chartForm: YeastForm = (pitchDetail?.strain_form as YeastForm) ?? "liquid";
  const chartInitialViability = pitchDetail?.initial_viability ?? 95;

  return (
    <div className="space-y-4">
      <EntityBreadcrumb
        entity={yeastPitchEntity as unknown as EntityConfig<Record<string, unknown>>}
        basePath="/production/yeast-pitches"
        id={id}
      />
      <EntityDetailUnifiedWithErrorBoundary
        entity={yeastPitchEntity as unknown as EntityConfig<Record<string, unknown>>}
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
    </div>
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

  // Compute total pitched quantity once for proportional cost allocation
  const totalQty = pitchEvents.reduce(
    (sum, e) => sum + (e.quantity_lbs ?? 0),
    0
  );

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
                      {totalQty > 0 && lineageSummary.original_cost != null && event.quantity_lbs != null
                        ? formatCurrency(
                            (lineageSummary.original_cost * event.quantity_lbs) / totalQty
                          )
                        : "\u2014"}
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
