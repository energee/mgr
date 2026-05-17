"use client";

import { useState, useEffect, type FormEvent } from "react";
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
import { batchKeys, dashboardKeys, entityKeys } from "@/lib/query-keys";

type SourceBatch = {
  id: string;
  batch_code: string;
  name: string | null;
  recipe_id: string | null;
  volume_bbl: number | null;
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

  useEffect(() => {
    if (!open || !source) return;
    setName(`${source.name ?? source.batch_code} (copy)`);
    setVolumeBbl(source.volume_bbl != null ? String(source.volume_bbl) : "");
    setPlannedStartDate(addDays(new Date(), 7).toISOString().slice(0, 10));
  }, [open, source]);

  const duplicateMutation = useMutation({
    mutationFn: async () => {
      if (!source) throw new Error("No source batch");

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
      queryClient.invalidateQueries({
        queryKey: entityKeys.all("batches_with_brew_info"),
      });
      queryClient.invalidateQueries({ queryKey: entityKeys.all("batches") });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.batchCounts() });
      toast.success("Batch duplicated");
      onOpenChange(false);
      onSuccess?.(newId);
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
