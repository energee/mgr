"use client";

/**
 * BatchTransferTimeline - Visual timeline of a batch's vessel transfers.
 *
 * Shows the journey of a batch through the brewery's vessels:
 * Kettle → FV3 → BT2 with dates, volumes, and vessel types.
 * Queries the `vessel_transfers_with_details` view (created in migration 00066).
 * Uses the existing Timeline UI component for consistent styling.
 */

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { batchKeys } from "@/lib/query-keys";
import { Badge } from "@/components/ui/badge";
import { UnitDisplay } from "@/components/ui/unit-input";
import {
  Timeline,
  TimelineItem,
  TimelineDot,
  TimelineConnector,
  TimelineContent,
  TimelineHeader,
  TimelineTitle,
  TimelineDescription,
  TimelineTime,
} from "@/components/ui/timeline";
import { ArrowRight } from "lucide-react";

type BatchTransferTimelineProps = {
  data: { id: string; [key: string]: unknown };
};

type TransferRecord = {
  id: string;
  from_vessel_name: string | null;
  to_vessel_name: string;
  volume_bbl: number;
  transferred_at: string;
  notes: string | null;
};

export function BatchTransferTimeline({ data }: BatchTransferTimelineProps) {
  const batchId = data.id;
  const supabase = createClient();

  const { data: transfers, isLoading } = useQuery({
    queryKey: batchKeys.transfers(batchId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vessel_transfers_with_details")
        .select("id, from_vessel_name, to_vessel_name, volume_bbl, transferred_at, notes")
        .eq("batch_id", batchId)
        .order("transferred_at", { ascending: true });
      if (error) throw error;
      return data as TransferRecord[];
    },
  });

  if (isLoading) {
    return (
      <div className="py-4 text-sm text-muted-foreground text-center">
        Loading transfer history...
      </div>
    );
  }

  if (!transfers || transfers.length === 0) {
    return (
      <div className="py-4 text-sm text-muted-foreground text-center">
        No vessel transfers recorded yet.
      </div>
    );
  }

  return (
    <Timeline activeIndex={transfers.length - 1}>
      {transfers.map((transfer) => (
        <TimelineItem key={transfer.id}>
          <TimelineDot />
          <TimelineConnector />
          <TimelineContent>
            <TimelineHeader>
              <TimelineTitle className="flex items-center gap-1.5 text-sm">
                <span className="text-muted-foreground">
                  {transfer.from_vessel_name ?? "Kettle"}
                </span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <span className="font-semibold">{transfer.to_vessel_name}</span>
              </TimelineTitle>
              <TimelineDescription className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] px-1 py-0">
                  <UnitDisplay value={transfer.volume_bbl} unitType="volume" />
                </Badge>
                {transfer.notes && (
                  <span className="truncate max-w-[200px]">{transfer.notes}</span>
                )}
              </TimelineDescription>
            </TimelineHeader>
            <TimelineTime dateTime={transfer.transferred_at}>
              {new Date(transfer.transferred_at).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </TimelineTime>
          </TimelineContent>
        </TimelineItem>
      ))}
    </Timeline>
  );
}
