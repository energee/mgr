"use client";

import { use, useCallback } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { EntityDetail } from "@/components/universal/entity-detail";
import { purchaseOrderEntity } from "@/entities/purchase-order";
import { calculateLandedCost } from "@/lib/purchasing/landed-cost";
import { purchaseOrderKeys, entityKeys } from "@/lib/query-keys";

export default function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const queryClient = useQueryClient();

  const handleAction = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (actionName: string, _data: any): boolean => {
      if (actionName === "calculate_landed_cost") {
        const run = async () => {
          try {
            const results = await calculateLandedCost(id);
            const lotsUpdated = results.filter((r) => r.lot_id != null).length;
            toast.success(
              `Landed cost calculated for ${lotsUpdated} inventory lot${lotsUpdated !== 1 ? "s" : ""}`
            );
            // Invalidate related caches
            queryClient.invalidateQueries({
              queryKey: purchaseOrderKeys.landedCost(id),
            });
            queryClient.invalidateQueries({
              queryKey: entityKeys.all("inventory_lots"),
            });
            queryClient.invalidateQueries({
              queryKey: entityKeys.detail("purchase_orders", id),
            });
          } catch (err) {
            console.error("Failed to calculate landed cost:", err);
            toast.error("Failed to calculate landed cost");
          }
        };
        run();
        return true; // Mark action as handled
      }
      return false; // Not handled, let default behavior run
    },
    [id, queryClient]
  );

  return (
    <EntityDetail
      entity={purchaseOrderEntity}
      id={id}
      basePath="/purchasing/pos"
      onAction={handleAction}
    />
  );
}
