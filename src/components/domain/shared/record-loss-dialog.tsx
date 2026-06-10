"use client";

/**
 * RecordLossDialog - Record a batch loss allocation
 *
 * Prompted when an implied loss is detected (vessel transfer left volume
 * behind, or packaging produced fewer units than planned). Inserts a
 * completed allocation with source_type='batch' / destination_type='loss'
 * and volume_bbl set — the same shape archive_batch_with_loss (migration
 * 00069) writes and the TTB report (00041) reads for the losses line.
 *
 * The suggested volume is editable; recording is optional (Skip).
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UnitInput } from "@/components/ui/unit-input";
import { Droplets, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { inventoryKeys } from "@/lib/query-keys";
import { recordBatchLoss } from "@/services/consumption-service";
import { formatServiceError } from "@/services/types";
import { REASON_CODES } from "@/entities/allocation";
import { log } from "@/lib/client-logger";

type RecordLossDialogProps = {
  batchId: string;
  batchNumber: string;
  /** Implied loss volume in bbl, pre-filled and editable. */
  suggestedVolumeBbl: number;
  /** Where the loss was detected — included in the allocation notes. */
  context: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecorded?: () => void;
};

export function RecordLossDialog({
  batchId,
  batchNumber,
  suggestedVolumeBbl,
  context,
  open,
  onOpenChange,
  onRecorded,
}: RecordLossDialogProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [volumeBbl, setVolumeBbl] = useState<number | null>(suggestedVolumeBbl);
  const [reasonCode, setReasonCode] = useState("spillage");
  const [notes, setNotes] = useState("");

  // Reset fields when the dialog opens (adjust-state-during-render pattern,
  // avoids a cascading setState-in-effect)
  const [prevOpen, setPrevOpen] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setVolumeBbl(suggestedVolumeBbl);
      setReasonCode("spillage");
      setNotes("");
    }
  }

  const recordMutation = useMutation({
    mutationFn: async () => {
      if (!volumeBbl || volumeBbl <= 0) throw new Error("Loss volume must be positive");
      const result = await recordBatchLoss(supabase, {
        batchId,
        volumeBbl,
        reasonCode,
        notes: [context, notes.trim()].filter(Boolean).join(" — "),
      });
      if (!result.success) throw new Error(formatServiceError(result.error));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.allocations() });
      toast.success(`Loss recorded for ${batchNumber}`);
      onOpenChange(false);
      onRecorded?.();
    },
    onError: (e) => {
      log.error("Record loss error:", e);
      toast.error(e instanceof Error ? e.message : "Failed to record loss");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Droplets className="h-5 w-5" />
            Record Loss
          </DialogTitle>
          <DialogDescription>
            {context} for batch {batchNumber}. Recording feeds the TTB losses
            line automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Loss Volume</Label>
            <UnitInput
              value={volumeBbl}
              onChange={(v) => setVolumeBbl(v)}
              unitType="volume"
              decimals={3}
              className="min-h-[44px]"
            />
          </div>

          <div className="space-y-2">
            <Label>Reason</Label>
            <Select value={reasonCode} onValueChange={setReasonCode}>
              <SelectTrigger className="min-h-[44px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REASON_CODES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="loss-notes">Notes (optional)</Label>
            <Textarea
              id="loss-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What happened..."
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Skip
          </Button>
          <Button
            type="button"
            onClick={() => recordMutation.mutate()}
            disabled={recordMutation.isPending || !volumeBbl || volumeBbl <= 0}
          >
            {recordMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Recording...
              </>
            ) : (
              "Record Loss"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
