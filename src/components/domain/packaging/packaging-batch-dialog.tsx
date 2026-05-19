"use client";

/**
 * Start Packaging Dialog
 *
 * Opens from a batch detail page to create a new packaging session
 * pre-populated with the batch's brand and the batch as the source.
 * User selects selling format and planned quantity, then the dialog
 * creates a session + line item and transitions the batch to "packaging".
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
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
import { Badge } from "@/components/ui/badge";
import {
  Combobox,
  ComboboxAnchor,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxTrigger,
} from "@/components/ui/combobox";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { entityKeys, batchKeys } from "@/lib/query-keys";
import { usePackagingFormats, useKegOwners, formatVolumeLabel } from "@/hooks/use-catalog";
import { useKegFormatIds } from "@/hooks/use-packaging";
import { createNameFilter } from "@/lib/combobox-filter";

// =============================================================================
// Types
// =============================================================================

type PackagingBatchDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: string;
  batchNumber: string;
  brandId: string;
  brandName: string;
};

// =============================================================================
// Component
// =============================================================================

export function PackagingBatchDialog({
  open,
  onOpenChange,
  batchId,
  batchNumber,
  brandId,
  brandName,
}: PackagingBatchDialogProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const router = useRouter();

  // Form state
  const [formatId, setFormatId] = useState("");
  const [kegOwnerId, setKegOwnerId] = useState("");
  const [plannedQuantity, setPlannedQuantity] = useState<number | null>(null);

  // Catalog data
  const { data: packagingFormats } = usePackagingFormats();
  const { data: kegOwners } = useKegOwners();

  // O(1) keg format lookup
  const kegFormatIds = useKegFormatIds();

  const isKeg = kegFormatIds.has(formatId);

  const createSession = useMutation({
    mutationFn: async () => {
      // 1. Create packaging session
      const { data: session, error: sessionError } = await supabase
        .from("packaging_sessions")
        .insert({
          session_date: new Date().toISOString().split("T")[0],
          status: "planned",
          notes: null,
        })
        .select("id")
        .single();
      if (sessionError) throw sessionError;

      // 2. Create line item
      const { error: lineError } = await supabase
        .from("session_line_items")
        .insert({
          session_id: session.id,
          brand_id: brandId,
          batch_id: batchId,
          selling_format_id: formatId || null,
          keg_owner_id: isKeg && kegOwnerId ? kegOwnerId : null,
          planned_quantity: plannedQuantity,
        });
      if (lineError) throw lineError;

      // 3. Transition batch to packaging
      const { error: batchError } = await supabase
        .from("batches")
        .update({ status: "packaging" })
        .eq("id", batchId);
      if (batchError) throw batchError;

      return session.id;
    },
    onSuccess: (sessionId) => {
      toast.success("Packaging session created");
      queryClient.invalidateQueries({ queryKey: batchKeys.detail(batchId) });
      queryClient.invalidateQueries({ queryKey: entityKeys.all("batches") });
      queryClient.invalidateQueries({
        queryKey: entityKeys.all("packaging_sessions"),
      });
      onOpenChange(false);
      router.push(`/production/packaging/${sessionId}`);
    },
    onError: () => {
      toast.error("Failed to create packaging session");
    },
  });

  const canSubmit = formatId && plannedQuantity != null && plannedQuantity > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start Packaging</DialogTitle>
          <DialogDescription>
            Create a new packaging session for this batch.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Read-only batch/brand info */}
          <div className="flex items-center gap-3">
            <Badge variant="outline">{batchNumber}</Badge>
            <span className="text-sm text-muted-foreground">{brandName}</span>
          </div>

          {/* Selling format */}
          <div className="space-y-2">
            <Label>Selling Format</Label>
            <Combobox
              value={formatId}
              onValueChange={(v) => {
                setFormatId(v);
                // Clear keg owner if switching away from keg
                if (!kegFormatIds.has(v)) {
                  setKegOwnerId("");
                }
              }}
              onFilter={createNameFilter(packagingFormats)}
            >
              <ComboboxAnchor>
                <ComboboxInput placeholder="Select format" />
                <ComboboxTrigger />
              </ComboboxAnchor>
              <ComboboxContent>
                <ComboboxEmpty>No formats found</ComboboxEmpty>
                {packagingFormats?.map((f) => (
                  <ComboboxItem key={f.id} value={f.id} label={f.name}>
                    <span className="flex items-center gap-2">
                      {f.name}
                      <span className="text-xs text-muted-foreground">
                        {formatVolumeLabel(f) ?? f.container_name}
                      </span>
                    </span>
                  </ComboboxItem>
                ))}
              </ComboboxContent>
            </Combobox>
          </div>

          {/* Keg owner (conditional) */}
          {isKeg && (
            <div className="space-y-2">
              <Label>Keg Owner</Label>
              <Combobox
                value={kegOwnerId}
                onValueChange={setKegOwnerId}
                onFilter={createNameFilter(kegOwners)}
              >
                <ComboboxAnchor>
                  <ComboboxInput placeholder="Keg owner (optional)" />
                  <ComboboxTrigger />
                </ComboboxAnchor>
                <ComboboxContent>
                  <ComboboxEmpty>No owners found</ComboboxEmpty>
                  {kegOwners?.map((o) => (
                    <ComboboxItem key={o.id} value={o.id} label={o.name}>
                      {o.name}
                    </ComboboxItem>
                  ))}
                </ComboboxContent>
              </Combobox>
            </div>
          )}

          {/* Planned quantity */}
          <div className="space-y-2">
            <Label>Planned Quantity</Label>
            <Input
              type="number"
              min={1}
              placeholder="e.g. 30"
              value={plannedQuantity ?? ""}
              onChange={(e) =>
                setPlannedQuantity(
                  e.target.value ? Number(e.target.value) : null
                )
              }
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={createSession.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => createSession.mutate()}
            disabled={!canSubmit || createSession.isPending}
          >
            {createSession.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Create Session
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
