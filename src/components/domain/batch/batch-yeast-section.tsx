"use client";

/**
 * Batch Yeast Section
 *
 * Displays pitched yeast activity for a batch detail page.
 * Queries the `batch_yeast_summary` view to show strain, generation,
 * quantity, cell count, viability, and pitch date for each event.
 *
 * Renders as a section within the batch detail, complementing the
 * PitchYeastDialog and YeastHarvestDialog actions.
 */

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { batchKeys } from "@/lib/query-keys";
import { formatCellCount } from "@/domain/yeast-calculations";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BatchYeastSummaryRow = {
  event_id: string;
  pitch_id: string;
  strain_id: string;
  strain_name: string;
  strain_code: string | null;
  generation: number;
  quantity_lbs: number | null;
  cells_pitched_thousand: number | null;
  viability_at_pitch: number | null;
  pitched_at: string | null;
}

type BatchYeastSectionProps = {
  /** Entity data passed by EntityDetailUnified section component pattern */
  data: {
    id: string;
    [key: string]: unknown;
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BatchYeastSection({ data }: BatchYeastSectionProps) {
  const batchId = data.id;
  const supabase = createClient();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: batchKeys.yeastSummary(batchId),
    queryFn: async () => {
      const { data: result, error } = await (supabase as unknown as { from: (table: string) => { select: (columns: string) => { eq: (column: string, value: string) => { order: (column: string, options: { ascending: boolean }) => PromiseLike<{ data: BatchYeastSummaryRow[] | null; error: unknown }> } } } })
        .from("batch_yeast_summary")
        .select("event_id, pitch_id, strain_id, strain_name, strain_code, generation, quantity_lbs, cells_pitched_thousand, viability_at_pitch, pitched_at")
        .eq("batch_id", batchId)
        .order("pitched_at", { ascending: true });
      if (error) throw error;
      return (result ?? []) as BatchYeastSummaryRow[];
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        No yeast pitched yet.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Strain</TableHead>
          <TableHead>Gen</TableHead>
          <TableHead>Qty (lbs)</TableHead>
          <TableHead>Cells</TableHead>
          <TableHead>Viability</TableHead>
          <TableHead>Date</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.event_id}>
            <TableCell className="font-medium">
              {row.strain_name}
              {row.strain_code && (
                <span className="text-muted-foreground ml-1 text-xs">
                  ({row.strain_code})
                </span>
              )}
            </TableCell>
            <TableCell>{row.generation}</TableCell>
            <TableCell>
              {row.quantity_lbs != null
                ? Number(row.quantity_lbs).toFixed(2)
                : "\u2014"}
            </TableCell>
            <TableCell>
              {row.cells_pitched_thousand != null
                ? formatCellCount(row.cells_pitched_thousand)
                : "\u2014"}
            </TableCell>
            <TableCell>
              {row.viability_at_pitch != null
                ? `${row.viability_at_pitch}%`
                : "\u2014"}
            </TableCell>
            <TableCell>
              {row.pitched_at
                ? new Date(row.pitched_at).toLocaleDateString()
                : "\u2014"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
