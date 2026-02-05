"use client";

/**
 * BrewLogBatches - Display linked batches for a brew log
 *
 * Shows batches that received wort from this brew, with volume allocations.
 */

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { brewLogKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/universal/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FlaskConical, Plus } from "lucide-react";
import { batchEntity } from "@/entities/batch";
import { UnitDisplay } from "@/components/ui/unit-input";
import type { Database } from "@/types/supabase";

type BrewLog = Database["public"]["Tables"]["brew_logs"]["Row"];

interface BrewLogBatchesProps {
  data: BrewLog;
}

export function BrewLogBatches({ data }: BrewLogBatchesProps) {
  const supabase = createClient();

  const { data: linkedBatches, isLoading } = useQuery({
    queryKey: brewLogKeys.batches(data.id),
    queryFn: async () => {
      const { data: links, error } = await supabase
        .from("brew_log_batches")
        .select(`
          id,
          volume_bbl,
          notes,
          batch:batches (
            id,
            batch_number,
            status,
            recipe:recipes (
              name
            )
          )
        `)
        .eq("brew_log_id", data.id);

      if (error) throw error;
      return links;
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (!linkedBatches || linkedBatches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-center">
        <FlaskConical className="h-10 w-10 text-muted-foreground/50 mb-3" />
        <p className="text-muted-foreground mb-4">No batches linked to this brew.</p>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/production/batches/new?brew_log_id=${data.id}`}>
            <Plus className="mr-1 h-4 w-4" />
            Create Batch
          </Link>
        </Button>
      </div>
    );
  }

  const totalVolume = linkedBatches.reduce(
    (sum, link) => sum + (Number(link.volume_bbl) || 0),
    0
  );

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Batch</TableHead>
            <TableHead>Recipe</TableHead>
            <TableHead>Volume</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {linkedBatches.map((link) => {
            const batch = link.batch as {
              id: string;
              batch_number: string;
              status: string;
              recipe: { name: string } | null;
            };
            return (
              <TableRow key={link.id}>
                <TableCell>
                  <Link
                    href={`/production/batches/${batch.id}`}
                    className="font-medium hover:underline"
                  >
                    {batch.batch_number}
                  </Link>
                </TableCell>
                <TableCell>{batch.recipe?.name || "—"}</TableCell>
                <TableCell><UnitDisplay value={link.volume_bbl} unitType="volume" /></TableCell>
                <TableCell>
                  <StatusBadge
                    status={batch.status}
                    config={batchEntity.stateMachine?.stateDisplay}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div className="flex justify-between items-center text-sm text-muted-foreground border-t pt-3">
        <span>Total Volume: <UnitDisplay value={totalVolume} unitType="volume" /></span>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/production/batches/new?brew_log_id=${data.id}`}>
            <Plus className="mr-1 h-4 w-4" />
            Add Batch
          </Link>
        </Button>
      </div>
    </div>
  );
}
