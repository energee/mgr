"use client";

/**
 * Batch Packaging History
 *
 * Read-only table showing all packaging session line items where a given batch
 * was the source. Displayed on the batch detail page below the entity detail.
 */

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { packagingKeys } from "@/lib/query-keys";
import { StatusBadge } from "@/components/universal/status-badge";
import { packagingSessionEntity } from "@/entities/packaging-session";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { formatDate } from "@/lib/format";

type PackagingHistoryRow = {
  id: string;
  session_id: string;
  selling_format_id: string | null;
  planned_quantity: number | null;
  actual_quantity: number | null;
  session_date: string;
  session_status: string;
  format_name: string | null;
};

export function BatchPackagingHistory({ batchId }: { batchId: string }) {
  const supabase = createClient();

  const { data: items, isLoading } = useQuery({
    queryKey: packagingKeys.historyForBatch(batchId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("session_line_items")
        .select(
          "id, session_id, selling_format_id, planned_quantity, actual_quantity, packaging_sessions(session_date, status), selling_formats(name)"
        )
        .eq("batch_id" as string, batchId);
      if (error) throw error;
      return (data ?? []).map((row) => {
        const session = row.packaging_sessions as unknown as {
          session_date: string;
          status: string;
        } | null;
        const format = row.selling_formats as unknown as {
          name: string;
        } | null;
        return {
          id: row.id,
          session_id: row.session_id,
          selling_format_id: row.selling_format_id,
          planned_quantity: row.planned_quantity,
          actual_quantity: row.actual_quantity,
          session_date: session?.session_date ?? "",
          session_status: session?.status ?? "",
          format_name: format?.name ?? null,
        } as PackagingHistoryRow;
      });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!items?.length) {
    return null;
  }

  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b px-4 py-3">
        <h3 className="text-sm font-medium">Packaging History</h3>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Format</TableHead>
            <TableHead className="text-right">Planned</TableHead>
            <TableHead className="text-right">Actual</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell>
                <Link
                  href={`/production/packaging/${item.session_id}`}
                  className="text-blue-600 underline"
                >
                  {formatDate(item.session_date)}
                </Link>
              </TableCell>
              <TableCell>{item.format_name ?? "—"}</TableCell>
              <TableCell className="text-right">
                {item.planned_quantity ?? "—"}
              </TableCell>
              <TableCell className="text-right">
                {item.actual_quantity ?? "—"}
              </TableCell>
              <TableCell>
                <StatusBadge
                  status={item.session_status}
                  config={
                    packagingSessionEntity.stateMachine?.stateDisplay
                  }
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
