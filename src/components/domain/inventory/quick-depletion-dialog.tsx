"use client";

/**
 * QuickDepletionDialog - Record common inventory depletions without the
 * raw-UUID generic allocation form (audit 9.4).
 *
 * Three modes mapping to allocation destination types:
 * - "sample"    → destination_type='sample'       (tax-free samples on TTB)
 * - "taproom"   → destination_type='taproom_sale'
 * - "write_off" → destination_type='destruction'
 *
 * The user picks a finished good or an inventory lot from a dropdown
 * (availability shown inline), enters quantity + reason + optional volume,
 * and a completed allocation is inserted via recordQuickDepletion.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UnitInput } from "@/components/ui/unit-input";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { consumptionKeys, inventoryKeys } from "@/lib/query-keys";
import {
  recordQuickDepletion,
  type QuickDepletionType,
} from "@/services/consumption-service";
import { formatServiceError, dynamicFrom } from "@/services/types";
import { REASON_CODES } from "@/entities/allocation";
import { log } from "@/lib/client-logger";

export type QuickDepletionMode = "sample" | "taproom" | "write_off";

const MODE_CONFIG: Record<
  QuickDepletionMode,
  { title: string; destinationType: QuickDepletionType; defaultReason: string }
> = {
  sample: { title: "Record Sample", destinationType: "sample", defaultReason: "sample_quality" },
  taproom: { title: "Taproom Depletion", destinationType: "taproom_sale", defaultReason: "other" },
  write_off: { title: "Write Off", destinationType: "destruction", defaultReason: "expired" },
};

type SourceOption = {
  id: string;
  label: string;
  available: number;
  lot_number: string | null;
};

type QuickDepletionDialogProps = {
  mode: QuickDepletionMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
};

export function QuickDepletionDialog({
  mode,
  open,
  onOpenChange,
  onSuccess,
}: QuickDepletionDialogProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const config = MODE_CONFIG[mode];

  const [sourceType, setSourceType] = useState<"finished_good" | "inventory_lot">("finished_good");
  const [sourceId, setSourceId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [volumeBbl, setVolumeBbl] = useState<number | null>(null);
  const [reasonCode, setReasonCode] = useState(config.defaultReason);
  const [notes, setNotes] = useState("");

  // Reset fields when the dialog opens or the mode changes
  // (adjust-state-during-render pattern, avoids setState-in-effect)
  const [prevKey, setPrevKey] = useState<string | null>(null);
  const renderKey = open ? mode : null;
  if (renderKey !== prevKey) {
    setPrevKey(renderKey);
    if (open) {
      setSourceType("finished_good");
      setSourceId("");
      setQuantity("");
      setVolumeBbl(null);
      setReasonCode(MODE_CONFIG[mode].defaultReason);
      setNotes("");
    }
  }

  // Source options: finished goods with availability, or lots with remaining qty
  const { data: sources, isLoading: sourcesLoading } = useQuery({
    queryKey: consumptionKeys.depletionSources(sourceType),
    queryFn: async (): Promise<SourceOption[]> => {
      if (sourceType === "finished_good") {
        const { data, error } = await supabase
          .from("finished_goods_with_availability")
          .select("id, brand_name, selling_format_name, lot_number, available_quantity")
          .gt("available_quantity", 0)
          .order("brand_name");
        if (error) throw error;
        return (data ?? [])
          .filter((fg) => fg.id)
          .map((fg) => ({
            id: fg.id as string,
            label: [fg.brand_name, fg.selling_format_name, fg.lot_number]
              .filter(Boolean)
              .join(" · "),
            available: fg.available_quantity ?? 0,
            lot_number: fg.lot_number,
          }));
      }
      const { data, error } = await dynamicFrom(supabase, "inventory_lots_with_quantities")
        .select("id, item_name, lot_number, remaining_quantity, unit")
        .gt("remaining_quantity", 0)
        .order("item_name");
      if (error) throw error;
      return ((data ?? []) as unknown as Array<{
        id: string;
        item_name: string | null;
        lot_number: string | null;
        remaining_quantity: number | null;
        unit: string | null;
      }>).map((lot) => ({
        id: lot.id,
        label: [lot.item_name, lot.lot_number].filter(Boolean).join(" · "),
        available: lot.remaining_quantity ?? 0,
        lot_number: lot.lot_number,
      }));
    },
    enabled: open,
  });

  const selectedSource = sources?.find((s) => s.id === sourceId);
  const parsedQuantity = parseFloat(quantity);
  const quantityValid = Number.isFinite(parsedQuantity) && parsedQuantity > 0;
  const exceedsAvailable =
    quantityValid && selectedSource ? parsedQuantity > selectedSource.available : false;

  const depleteMutation = useMutation({
    mutationFn: async () => {
      if (!sourceId || !quantityValid) throw new Error("Pick a source and quantity");
      const result = await recordQuickDepletion(supabase, {
        sourceType,
        sourceId,
        destinationType: config.destinationType,
        quantity: parsedQuantity,
        volumeBbl,
        reasonCode,
        notes: notes.trim() || null,
      });
      if (!result.success) throw new Error(formatServiceError(result.error));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.allocations() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.lots() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.finishedGoodsAvailable() });
      toast.success(`${config.title} recorded`);
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (e) => {
      log.error("Quick depletion error:", e);
      toast.error(e instanceof Error ? e.message : "Failed to record depletion");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{config.title}</DialogTitle>
          <DialogDescription>
            Records a completed allocation — no UUIDs required.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Source</Label>
            <Select
              value={sourceType}
              onValueChange={(v) => {
                setSourceType(v as "finished_good" | "inventory_lot");
                setSourceId("");
              }}
            >
              <SelectTrigger className="min-h-[44px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="finished_good">Finished Good</SelectItem>
                <SelectItem value="inventory_lot">Inventory Lot</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{sourceType === "finished_good" ? "Finished Good" : "Lot"}</Label>
            <Select value={sourceId} onValueChange={setSourceId} disabled={sourcesLoading}>
              <SelectTrigger className="min-h-[44px]">
                <SelectValue
                  placeholder={sourcesLoading ? "Loading..." : "Select..."}
                />
              </SelectTrigger>
              <SelectContent>
                {sources?.length === 0 ? (
                  <div className="p-2 text-sm text-muted-foreground text-center">
                    Nothing available
                  </div>
                ) : (
                  sources?.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                      <span className="text-muted-foreground ml-2">
                        ({s.available} available)
                      </span>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="depletion-quantity">Quantity</Label>
            <Input
              id="depletion-quantity"
              type="number"
              min={0}
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="e.g., 2"
              className="min-h-[44px]"
            />
            {exceedsAvailable && (
              <p className="text-sm text-yellow-700">
                Exceeds available quantity ({selectedSource?.available}).
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Volume (optional, for TTB)</Label>
            <UnitInput
              value={volumeBbl}
              onChange={setVolumeBbl}
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
            <Label htmlFor="depletion-notes">Notes (optional)</Label>
            <Textarea
              id="depletion-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => depleteMutation.mutate()}
            disabled={depleteMutation.isPending || !sourceId || !quantityValid}
          >
            {depleteMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Recording...
              </>
            ) : (
              "Record"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
