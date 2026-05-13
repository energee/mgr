"use client";

/**
 * BatchDuplicateDialog
 *
 * Quick-creates a new planned batch from an existing one. Copies the
 * recipe link, target volume, name, and planned start date — but NOT
 * brew history (additions, readings, logs). The user can edit before
 * the new batch is saved. Audit F-111.
 */

import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addDays } from "date-fns";
import { toast } from "sonner";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Copy, Loader2 } from "lucide-react";
import { batchKeys } from "@/lib/query-keys";

type SourceBatch = {
  id: string;
  batch_code: string;
  name: string | null;
  recipe_id: string | null;
  volume_bbl: number | null;
  planned_start_date: string | null;
};

export function BatchDuplicateDialog({
  source,
  open,
  onOpenChange,
  onSuccess,
}: {
  source: SourceBatch | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (newBatchId: string) => void;
}) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [volumeBbl, setVolumeBbl] = useState<string>("");
  const [plannedStartDate, setPlannedStartDate] = useState<string>("");

  // Reset form when a new source comes in
  if (source && open && name === "" && volumeBbl === "") {
    setName(`${source.name ?? source.batch_code} (copy)`);
    if (source.volume_bbl != null) setVolumeBbl(String(source.volume_bbl));
    // Default planned date: 7 days from now (next brew day).
    setPlannedStartDate(
      addDays(new Date(), 7).toISOString().slice(0, 10),
    );
  }

  const duplicateMutation = useMutation({
    mutationFn: async () => {
      if (!source) throw new Error("No source batch");

      // Don't copy batch_code — let the DB sequence assign a fresh one.
      // Don't copy status — new batch starts as "planned".
      const insertPayload = {
        name,
        recipe_id: source.recipe_id,
        volume_bbl: volumeBbl ? Number(volumeBbl) : null,
        planned_start_date: plannedStartDate || null,
        status: "planned" as const,
      };

      const { data, error } = await supabase
        .from("batches")
        .insert(insertPayload)
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (newId) => {
      queryClient.invalidateQueries({ queryKey: batchKeys.all() });
      toast.success("Batch duplicated");
      onOpenChange(false);
      onSuccess?.(newId);
      // Reset form state for next open
      setName("");
      setVolumeBbl("");
      setPlannedStartDate("");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    duplicateMutation.mutate();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setName("");
          setVolumeBbl("");
          setPlannedStartDate("");
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="h-5 w-5" />
            Duplicate batch
          </DialogTitle>
          <DialogDescription>
            Create a new planned batch from{" "}
            <span className="font-medium">{source?.batch_code}</span>. Copies
            the recipe and target volume — not brew history.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="dup-name">New batch name</Label>
            <Input
              id="dup-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="min-h-[44px]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="dup-volume">Volume (BBL)</Label>
              <Input
                id="dup-volume"
                type="number"
                step="0.1"
                min="0"
                value={volumeBbl}
                onChange={(e) => setVolumeBbl(e.target.value)}
                className="min-h-[44px]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dup-date">Planned start</Label>
              <Input
                id="dup-date"
                type="date"
                value={plannedStartDate}
                onChange={(e) => setPlannedStartDate(e.target.value)}
                className="min-h-[44px]"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={duplicateMutation.isPending}
              className="min-h-[44px]"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={duplicateMutation.isPending || !name}
              className="min-h-[44px]"
            >
              {duplicateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Duplicating…
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 mr-2" />
                  Duplicate batch
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
