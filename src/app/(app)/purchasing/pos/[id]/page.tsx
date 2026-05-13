"use client";

/**
 * Purchase Order Detail Page
 *
 * Renders the PO detail view with custom action handlers for:
 * - "Accept into Inventory" — opens dialog to create inventory lots from po_receives
 * - "Calculate Landed Cost" — distributes shipping/tax across inventory lots
 */

import { use, useCallback, useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { purchaseOrderEntity } from "@/entities/purchase-order";
import { calculateLandedCost } from "@/lib/purchasing/landed-cost";
import { POAcceptInventoryDialog } from "@/components/domain/po-accept-inventory-dialog";
import { PoLandedCostBreakdown } from "@/components/domain/po-landed-cost-breakdown";
import { purchaseOrderKeys, entityKeys, landedCostKeys } from "@/lib/query-keys";
import { log } from "@/lib/client-logger";

const LANDED_COST_STATUSES = ["partial", "fulfilled", "closed"];

export default function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const [acceptDialogOpen, setAcceptDialogOpen] = useState(false);

  /** Fetch PO status to conditionally show the landed cost breakdown */
  const { data: poStatus } = useQuery({
    queryKey: purchaseOrderKeys.status(id),
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("purchase_orders")
        .select("status")
        .eq("id", id)
        .single();
      return data?.status as string | undefined;
    },
  });
  const showLandedCost = !!poStatus && LANDED_COST_STATUSES.includes(poStatus);

  const handleAction = useCallback(
    (actionName: string): boolean => {
      if (actionName === "accept_into_inventory") {
        setAcceptDialogOpen(true);
        return true;
      }

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
              queryKey: landedCostKeys.summary(id),
            });
            queryClient.invalidateQueries({
              queryKey: entityKeys.all("inventory_lots"),
            });
            queryClient.invalidateQueries({
              queryKey: entityKeys.detail("purchase_orders", id),
            });
          } catch (err) {
            log.error("Failed to calculate landed cost:", err);
            toast.error("Failed to calculate landed cost");
          }
        };
        run();
        return true;
      }

      return false;
    },
    [id, queryClient]
  );

  return (
    <>
      <EntityDetailPage
        entity={purchaseOrderEntity}
        id={id}
        basePath="/purchasing/pos"
        onAction={handleAction}
      />
      {showLandedCost && (
        <div className="mt-4">
          <PoLandedCostBreakdown poId={id} />
        </div>
      )}
      <POAcceptInventoryDialog
        poId={id}
        open={acceptDialogOpen}
        onClose={() => setAcceptDialogOpen(false)}
      />
    </>
  );
}
