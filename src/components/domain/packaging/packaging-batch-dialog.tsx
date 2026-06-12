"use client";

/**
 * Start Packaging Dialog
 *
 * Opens from the batch detail or list page to package a batch, pre-populated
 * with the batch's brand and the batch as the source.
 * When the batch has no recipe/brand (`brandId` is null), a brand Combobox is
 * shown instead — session_line_items.brand_id is NOT NULL, so a brand must be
 * collected before the session can be created.
 * User picks a session (new session dated today, or an existing
 * planned/in_progress one — so packaging several batches in one run doesn't
 * spawn one session per batch), a selling format, and a planned quantity.
 * Selecting a format prefills the quantity with
 * floor(batch volume ÷ per-unit fill volume) as an editable suggestion.
 * Submitting creates/links the line item and transitions the batch to
 * "packaging".
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { entityKeys, batchKeys, packagingKeys } from "@/lib/query-keys";
import { usePackagingFormats, useKegOwners, useBrands, formatVolumeLabel } from "@/hooks/use-catalog";
import {
  useKegFormatIds,
  useOpenPackagingSessions,
  useSellingFormatFillVolumes,
  suggestPlannedQuantity,
} from "@/hooks/use-packaging";
import { createNameFilter } from "@/lib/combobox-filter";
import { parseUnknownError } from "@/lib/errors";
import { formatDate, formatSmartDecimal } from "@/lib/format";

// =============================================================================
// Types
// =============================================================================

type PackagingBatchDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: string;
  batchNumber: string;
  /** Brand from the batch's recipe; null when the batch has no recipe or the recipe has no brand (a brand picker is shown instead). */
  brandId: string | null;
  brandName: string | null;
  /** Batch volume in BBL; used to suggest the planned quantity once a format is picked. Null disables the suggestion. */
  volumeBbl: number | null;
};

/** Sentinel for the "create a new session dated today" choice in the session Select. */
const NEW_SESSION = "__new__";

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
  volumeBbl,
}: PackagingBatchDialogProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const router = useRouter();

  // Form state
  const [formatId, setFormatId] = useState("");
  const [kegOwnerId, setKegOwnerId] = useState("");
  const [plannedQuantity, setPlannedQuantity] = useState<number | null>(null);
  // Last auto-suggested quantity; lets a format switch replace the suggestion
  // without ever clobbering a value the user typed themselves.
  const [lastSuggestion, setLastSuggestion] = useState<number | null>(null);
  // Brand picked in-dialog when the batch has no recipe brand (brandId prop null)
  const [selectedBrandId, setSelectedBrandId] = useState("");
  // Target session: new session dated today (default) or an existing open one
  const [sessionChoice, setSessionChoice] = useState<string>(NEW_SESSION);

  // Catalog data
  const { data: packagingFormats } = usePackagingFormats();
  const { data: kegOwners } = useKegOwners();
  const { data: brands } = useBrands();
  const { data: openSessions } = useOpenPackagingSessions(open);
  // Per-unit fill volume (containers.volume_bbl × unit_count) per format
  const fillVolumes = useSellingFormatFillVolumes();

  // session_line_items.brand_id is NOT NULL — use the recipe's brand when
  // available, otherwise the one picked in the dialog.
  const effectiveBrandId = brandId ?? (selectedBrandId || null);

  // O(1) keg format lookup
  const kegFormatIds = useKegFormatIds();

  const isKeg = kegFormatIds.has(formatId);

  // Quantity suggestion for the selected format: floor(batch volume ÷
  // per-unit fill volume). Null when either volume is unknown.
  const unitFillVolume = formatId ? (fillVolumes.get(formatId) ?? null) : null;
  const suggestedQuantity = suggestPlannedQuantity(volumeBbl, unitFillVolume);

  /**
   * Format selection: prefill the planned quantity with the suggestion as an
   * editable value. Only overwrites the field when it is empty or still holds
   * the previous suggestion — never a value the user typed.
   */
  const handleFormatChange = (v: string) => {
    setFormatId(v);
    // Clear keg owner if switching away from keg
    if (!kegFormatIds.has(v)) {
      setKegOwnerId("");
    }
    const suggestion = suggestPlannedQuantity(
      volumeBbl,
      fillVolumes.get(v) ?? null
    );
    if (plannedQuantity == null || plannedQuantity === lastSuggestion) {
      setPlannedQuantity(suggestion);
    }
    setLastSuggestion(suggestion);
  };

  const createSession = useMutation({
    mutationFn: async () => {
      // Guard: canSubmit already requires a brand; this satisfies the
      // NOT NULL insert type and protects against programmatic calls.
      if (!effectiveBrandId) throw new Error("Brand is required");

      // 1. Resolve target session: reuse the chosen open session, or create
      //    a new one dated today.
      let sessionId = sessionChoice;
      if (sessionId === NEW_SESSION) {
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
        sessionId = session.id;
      }

      // 2. Create line item
      const { error: lineError } = await supabase
        .from("session_line_items")
        .insert({
          session_id: sessionId,
          brand_id: effectiveBrandId,
          batch_id: batchId,
          selling_format_id: formatId || null,
          keg_owner_id: isKeg && kegOwnerId ? kegOwnerId : null,
          planned_quantity: plannedQuantity,
        });
      if (lineError) throw lineError;

      // 3. Transition batch to packaging (both new- and existing-session paths)
      const { error: batchError } = await supabase
        .from("batches")
        .update({ status: "packaging" })
        .eq("id", batchId);
      if (batchError) throw batchError;

      return sessionId;
    },
    onSuccess: (sessionId) => {
      toast.success(
        sessionChoice === NEW_SESSION
          ? "Packaging session created"
          : `Batch ${batchNumber} added to packaging session`
      );
      queryClient.invalidateQueries({ queryKey: batchKeys.detail(batchId) });
      queryClient.invalidateQueries({ queryKey: entityKeys.all("batches") });
      queryClient.invalidateQueries({
        queryKey: entityKeys.all("packaging_sessions"),
      });
      queryClient.invalidateQueries({
        queryKey: packagingKeys.historyForBatch(batchId),
      });
      onOpenChange(false);
      router.push(`/production/packaging/${sessionId}`);
    },
    onError: (err: unknown) => {
      toast.error(`Failed to start packaging: ${parseUnknownError(err).message}`);
    },
  });

  const canSubmit =
    !!effectiveBrandId && formatId && plannedQuantity != null && plannedQuantity > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start Packaging</DialogTitle>
          <DialogDescription>
            Create a new packaging session for this batch, or add it to an
            existing one.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Read-only batch/brand info */}
          <div className="flex items-center gap-3">
            <Badge variant="outline">{batchNumber}</Badge>
            {brandName && (
              <span className="text-sm text-muted-foreground">{brandName}</span>
            )}
          </div>

          {/* Brand picker — only when the batch has no recipe brand */}
          {brandId === null && (
            <div className="space-y-2">
              <Label>Brand</Label>
              <Combobox
                value={selectedBrandId}
                onValueChange={setSelectedBrandId}
                onFilter={createNameFilter(brands)}
              >
                <ComboboxAnchor>
                  <ComboboxInput placeholder="Select brand" />
                  <ComboboxTrigger />
                </ComboboxAnchor>
                <ComboboxContent>
                  <ComboboxEmpty>No brands found</ComboboxEmpty>
                  {brands?.map((b) => (
                    <ComboboxItem key={b.id} value={b.id} label={b.name}>
                      {b.name}
                    </ComboboxItem>
                  ))}
                </ComboboxContent>
              </Combobox>
              <p className="text-xs text-muted-foreground">
                This batch has no recipe brand, so pick the brand to package under.
              </p>
            </div>
          )}

          {/* Target session: new (today) or an existing open session */}
          <div className="space-y-2">
            <Label>Session</Label>
            <Select value={sessionChoice} onValueChange={setSessionChoice}>
              <SelectTrigger>
                <SelectValue placeholder="Select session" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NEW_SESSION}>New session (today)</SelectItem>
                {openSessions?.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.session_date ? formatDate(s.session_date) : "No date"} —{" "}
                    {s.status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Selling format */}
          <div className="space-y-2">
            <Label>Selling Format</Label>
            <Combobox
              value={formatId}
              onValueChange={handleFormatChange}
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

          {/* Planned quantity (prefilled from batch volume when a format is picked) */}
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
            {suggestedQuantity != null && unitFillVolume != null && (
              <p className="text-xs text-muted-foreground">
                Suggested {suggestedQuantity} from{" "}
                {formatSmartDecimal(volumeBbl)} BBL batch ÷{" "}
                {formatSmartDecimal(unitFillVolume, 4)} BBL per unit. Adjust as
                needed.
              </p>
            )}
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
            {sessionChoice === NEW_SESSION ? "Create Session" : "Add to Session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
