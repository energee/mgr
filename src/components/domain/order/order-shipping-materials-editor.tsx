"use client";

/**
 * OrderShippingMaterialsEditor — displays auto-calculated shipping materials
 * for an order with user-editable actual quantities.
 *
 * Estimated quantities are read-only (calculated from the order's BOM).
 * Actual quantities default to estimated_qty when null and are saved on blur
 * via a direct Supabase mutation.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { unwrap } from "@/lib/supabase/query-helpers";
import { dynamicFrom } from "@/services/types";
import { materialPlanningKeys } from "@/lib/query-keys";
import {
  useOrderMaterials,
  type OrderMaterial,
} from "@/hooks/use-material-planning";
import { EmptyStateHint } from "@/components/universal/empty-state-hint";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

// =============================================================================
// Types
// =============================================================================

type OrderShippingMaterialsEditorProps = {
  orderId: string;
  disabled?: boolean;
};

// =============================================================================
// Component
// =============================================================================

/**
 * Renders a shipping materials table for an order. Estimated quantities are
 * auto-calculated from the order's BOM; actual quantities are editable in-place
 * and saved on blur.
 */
export function OrderShippingMaterialsEditor({
  orderId,
  disabled = false,
}: OrderShippingMaterialsEditorProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  const { data: materials = [], isLoading } = useOrderMaterials(orderId);

  // ---------------------------------------------------------------------------
  // Mutation
  // ---------------------------------------------------------------------------

  const updateMutation = useMutation({
    mutationFn: async ({ id, actual_qty }: { id: string; actual_qty: number | null }) => {
      await unwrap(dynamicFrom(supabase, "order_materials")
        .update({ actual_qty } as never)
        .eq("id", id));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: materialPlanningKeys.orderMaterials(orderId),
      });
    },
    onError: () => {
      toast.error("Failed to save actual quantity");
    },
  });

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  if (materials.length === 0) {
    return (
      <EmptyStateHint
        message="No shipping materials calculated. Materials are auto-calculated from order line items when selling formats have BOMs and pallet quantities configured."
        href="/settings/selling-formats"
        linkLabel="Configure in Settings > Selling Formats"
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Material</TableHead>
          <TableHead className="w-32 text-right">Estimated</TableHead>
          <TableHead className="w-32 text-right">Actual</TableHead>
          <TableHead className="w-24">Unit</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {materials.map((row) => (
          <MaterialRow
            // Server values are part of the key so a refetch that changes them
            // remounts the row with a fresh input seed. MaterialRow seeds its
            // Actual input from props once and never resyncs; without this,
            // blurring an input the user never typed into would compare the
            // stale seed against the fresh row and persist the old number as a
            // manual actual_qty override, which recalculate_order_materials
            // deliberately never corrects (issue #614).
            key={`${row.id}:${row.estimated_qty}:${row.actual_qty ?? ""}`}
            row={row}
            disabled={disabled || updateMutation.isPending}
            onActualBlur={(value) => {
              const parsed = value.trim() === "" ? null : parseFloat(value);
              const actual_qty = parsed !== null && isNaN(parsed) ? null : parsed;
              const current = row.actual_qty ?? row.estimated_qty;
              if (actual_qty !== current) {
                updateMutation.mutate({ id: row.id, actual_qty });
              }
            }}
          />
        ))}
      </TableBody>
    </Table>
  );
}

// =============================================================================
// MaterialRow — individual editable row
// =============================================================================

type MaterialRowProps = {
  row: OrderMaterial;
  disabled: boolean;
  onActualBlur: (value: string) => void;
};

/** A single row in the shipping materials table. Local state tracks the actual qty input. */
function MaterialRow({ row, disabled, onActualBlur }: MaterialRowProps) {
  const effectiveActual = row.actual_qty ?? row.estimated_qty;
  const [actualValue, setActualValue] = useState(String(effectiveActual));

  const item = row.inventory_item;
  const uom = item?.unit ?? "—";

  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{item?.name ?? row.inventory_item_id}</div>
        {item?.category && (
          <div className="text-xs text-muted-foreground">{item.category}</div>
        )}
      </TableCell>
      <TableCell className="text-right text-muted-foreground">
        {row.estimated_qty}
      </TableCell>
      <TableCell className="text-right">
        <Input
          type="number"
          step="0.001"
          min="0"
          value={actualValue}
          onChange={(e) => setActualValue(e.target.value)}
          onBlur={() => onActualBlur(actualValue)}
          disabled={disabled}
          className="w-24 text-right ml-auto"
        />
      </TableCell>
      <TableCell className="text-muted-foreground text-sm">{uom}</TableCell>
    </TableRow>
  );
}
