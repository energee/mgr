"use client";

/**
 * StartBrewDayDialog - Single-step confirmation for starting a brew day
 *
 * Accepts a pre-selected batch and creates a brew log linked to it.
 * The batch must already exist (planned status). Recipe info is derived
 * from the batch, not selected in this dialog.
 */

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { brewLogKeys, entityKeys, batchKeys, userKeys } from "@/lib/query-keys";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Play, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { UnitDisplay } from "@/components/ui/unit-input";

// =============================================================================
// Types
// =============================================================================

interface StartBrewDayDialogProps {
  batchId: string;
  batchNumber: string;
  batchName: string | null;
  recipeName: string | null;
  volumeBbl: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (brewLogId: string) => void;
}

// =============================================================================
// Helpers
// =============================================================================

function generateBrewNumber(): string {
  const now = new Date();
  const year = now.getFullYear();
  const dayOfYear = Math.floor(
    (now.getTime() - new Date(year, 0, 0).getTime()) / 86400000
  );
  return `BRW-${year}-${String(dayOfYear).padStart(3, "0")}`;
}

// =============================================================================
// Component
// =============================================================================

export function StartBrewDayDialog({
  batchId,
  batchNumber,
  batchName,
  recipeName,
  volumeBbl,
  open,
  onOpenChange,
  onSuccess,
}: StartBrewDayDialogProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  const [brewDate, setBrewDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [brewNumber, setBrewNumber] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch current user for brewer default
  const { data: currentUser } = useQuery({
    queryKey: userKeys.current(),
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return user;
    },
    enabled: open,
  });

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setBrewDate(new Date().toISOString().split("T")[0]);
      setBrewNumber(generateBrewNumber());
    }
  }, [open]);

  const isValid = brewNumber.trim().length > 0 && brewDate.length > 0;

  const handleSubmit = async () => {
    if (!isValid) return;
    setIsSubmitting(true);

    try {
      // 1. Create brew log
      const { data: brewLog, error: brewLogError } = await supabase
        .from("brew_logs")
        .insert({
          brew_number: brewNumber.trim(),
          brew_date: brewDate,
          brewer_id: currentUser?.id ?? null,
          status: "draft",
        })
        .select("id")
        .single();

      if (brewLogError) throw brewLogError;
      const brewLogId = brewLog.id as string;

      // 2. Link brew log to batch
      const { error: junctionError } = await supabase
        .from("brew_log_batches")
        .insert({
          brew_log_id: brewLogId,
          batch_id: batchId,
          volume_bbl: volumeBbl ?? 0,
        });

      if (junctionError) throw junctionError;

      // Invalidate caches
      queryClient.invalidateQueries({ queryKey: brewLogKeys.all() });
      queryClient.invalidateQueries({ queryKey: batchKeys.all() });
      queryClient.invalidateQueries({ queryKey: entityKeys.all("brew_logs") });
      queryClient.invalidateQueries({ queryKey: entityKeys.all("batches") });

      toast.success(`Brew day started for ${batchNumber}`);
      onOpenChange(false);
      onSuccess(brewLogId);
    } catch (error) {
      console.error("Start brew day error:", error);
      const message =
        error instanceof Error ? error.message : "Failed to start brew day";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="h-5 w-5" />
            Start Brew Day
          </DialogTitle>
          <DialogDescription>
            Create a brew log for this batch.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Batch info (read-only) */}
          <div className="rounded-md border bg-muted/30 p-3 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Batch</span>
              <span className="font-medium">{batchNumber}</span>
            </div>
            {batchName && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Name</span>
                <span>{batchName}</span>
              </div>
            )}
            {recipeName && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Recipe</span>
                <span>{recipeName}</span>
              </div>
            )}
            {volumeBbl != null && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Volume</span>
                <span>
                  <UnitDisplay value={volumeBbl} unitType="volume" />
                </span>
              </div>
            )}
          </div>

          {/* Brew date */}
          <div className="space-y-2">
            <Label htmlFor="brew-date">Brew Date</Label>
            <Input
              id="brew-date"
              type="date"
              value={brewDate}
              onChange={(e) => setBrewDate(e.target.value)}
            />
          </div>

          {/* Brew number */}
          <div className="space-y-2">
            <Label htmlFor="brew-number">Brew Number</Label>
            <Input
              id="brew-number"
              type="text"
              value={brewNumber}
              onChange={(e) => setBrewNumber(e.target.value)}
              placeholder="e.g., BRW-2024-001"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !isValid}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Start Brew Day
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
