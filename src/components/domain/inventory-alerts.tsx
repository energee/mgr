"use client";

/**
 * InventoryAlerts - AI-powered inventory overview and alerts
 *
 * Displays inventory status for finished goods, raw materials, and
 * batches in progress. Highlights low stock and availability issues.
 * Uses the get_inventory_overview database function.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { inventoryKeys } from "@/lib/query-keys";
import { dynamicRpc } from "@/services/types";
import { CACHE_DURATIONS } from "@/lib/constants";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertTriangle,
  ChevronDown,
  Package,
  Warehouse,
  Beaker,
  RefreshCw,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/universal/status-badge";
import { batchEntity } from "@/entities/batch";

// =============================================================================
// Types
// =============================================================================

type FinishedGood = {
  brand: string;
  package_type: string;
  total_quantity: number;
  available_quantity: number;
}

type RawMaterial = {
  item_name: string;
  item_type: string;
  quantity_available: number;
  unit: string;
}

type BatchInProgress = {
  batch_number: string;
  recipe_name: string;
  status: string;
  planned_start: string | null;
}

type InventoryOverview = {
  finished_goods: FinishedGood[] | null;
  raw_materials: RawMaterial[] | null;
  batches_in_progress: BatchInProgress[] | null;
}

type InventoryAlertsProps = {
  /** Threshold below which to show low stock warning for finished goods */
  lowStockThreshold?: number;
  /** Whether to auto-expand when alerts are present */
  autoExpandOnAlerts?: boolean;
}

// =============================================================================
// Helper Components
// =============================================================================

function FinishedGoodsSection({
  goods,
  lowStockThreshold = 24,
}: {
  goods: FinishedGood[];
  lowStockThreshold?: number;
}) {
  // Sort by available quantity to show low stock first
  const sortedGoods = [...goods].sort(
    (a, b) => a.available_quantity - b.available_quantity
  );

  return (
    <div className="space-y-2">
      <h4 className="font-medium flex items-center gap-2">
        <Package className="h-4 w-4" />
        Finished Goods ({goods.length})
      </h4>
      <div className="border rounded-lg divide-y max-h-48 overflow-y-auto">
        {sortedGoods.map((item, idx) => {
          const isLowStock = item.available_quantity < lowStockThreshold;
          const hasAllocations = item.available_quantity < item.total_quantity;

          return (
            <div
              key={`${item.brand}-${item.package_type}-${idx}`}
              className="flex items-center justify-between p-2 text-sm"
            >
              <div className="flex items-center gap-2">
                {isLowStock ? (
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                )}
                <div>
                  <span className="font-medium">{item.brand}</span>
                  <span className="text-muted-foreground ml-1">
                    {item.package_type}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {hasAllocations && (
                  <span className="text-xs text-muted-foreground">
                    {item.total_quantity} total
                  </span>
                )}
                <Badge variant={isLowStock ? "destructive" : "secondary"}>
                  {item.available_quantity} avail
                </Badge>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RawMaterialsSection({ materials }: { materials: RawMaterial[] }) {
  // Group by type
  const grouped = materials.reduce(
    (acc, item) => {
      const type = item.item_type || "other";
      if (!acc[type]) acc[type] = [];
      acc[type].push(item);
      return acc;
    },
    {} as Record<string, RawMaterial[]>
  );

  return (
    <div className="space-y-2">
      <h4 className="font-medium flex items-center gap-2">
        <Warehouse className="h-4 w-4" />
        Raw Materials ({materials.length})
      </h4>
      <div className="border rounded-lg divide-y max-h-48 overflow-y-auto">
        {Object.entries(grouped).map(([type, items]) => (
          <div key={type} className="p-2">
            <div className="text-xs text-muted-foreground uppercase mb-1">
              {type}
            </div>
            <div className="space-y-1">
              {items.slice(0, 5).map((item, idx) => (
                <div
                  key={`${item.item_name}-${idx}`}
                  className="flex items-center justify-between text-sm"
                >
                  <span>{item.item_name}</span>
                  <span className="text-muted-foreground">
                    {item.quantity_available.toFixed(1)} {item.unit}
                  </span>
                </div>
              ))}
              {items.length > 5 && (
                <div className="text-xs text-muted-foreground">
                  +{items.length - 5} more
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BatchesInProgressSection({ batches }: { batches: BatchInProgress[] }) {
  return (
    <div className="space-y-2">
      <h4 className="font-medium flex items-center gap-2">
        <Beaker className="h-4 w-4" />
        Batches In Progress ({batches.length})
      </h4>
      <div className="border rounded-lg divide-y max-h-48 overflow-y-auto">
        {batches.map((batch, idx) => (
          <div
            key={`${batch.batch_number}-${idx}`}
            className="flex items-center justify-between p-2 text-sm"
          >
            <div>
              <span className="font-medium">{batch.batch_number}</span>
              <span className="text-muted-foreground ml-1">
                {batch.recipe_name}
              </span>
            </div>
            <StatusBadge
              status={batch.status}
              config={batchEntity.stateMachine?.stateDisplay}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function InventoryAlerts({
  lowStockThreshold = 24,
  autoExpandOnAlerts = true,
}: InventoryAlertsProps) {
  const supabase = createClient();

  // Fetch inventory overview
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: inventoryKeys.overview(),
    queryFn: async () => {
      const { data, error } = await dynamicRpc(supabase, "get_inventory_overview");

      if (error) throw error;
      return data as InventoryOverview;
    },
    staleTime: CACHE_DURATIONS.STATIC_DATA,
  });

  const overview = data as InventoryOverview | undefined;

  // Calculate alerts
  const lowStockCount =
    overview?.finished_goods?.filter(
      (item) => item.available_quantity < lowStockThreshold
    ).length || 0;

  const batchCount = overview?.batches_in_progress?.length || 0;

  // Auto-expand if there are alerts
  const hasAlerts = lowStockCount > 0;
  const [isOpen, setIsOpen] = useState(false);
  const [prevHasAlerts, setPrevHasAlerts] = useState(hasAlerts);

  // Auto-expand when alerts are first detected (React recommended pattern:
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders)
  if (hasAlerts !== prevHasAlerts) {
    setPrevHasAlerts(hasAlerts);
    if (autoExpandOnAlerts && hasAlerts) {
      setIsOpen(true);
    }
  }

  return (
    <Card>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Warehouse className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Inventory Overview</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              {!isLoading && overview && (
                <>
                  {lowStockCount > 0 && (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      {lowStockCount} low stock
                    </Badge>
                  )}
                  {batchCount > 0 && (
                    <Badge variant="secondary" className="gap-1">
                      <Beaker className="h-3 w-3" />
                      {batchCount} brewing
                    </Badge>
                  )}
                </>
              )}
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={isOpen ? "Collapse alerts" : "Expand alerts"}>
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
                  />
                </Button>
              </CollapsibleTrigger>
            </div>
          </div>
          <CardDescription>
            Real-time inventory status and alerts
          </CardDescription>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="space-y-6">
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <AlertTriangle className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-muted-foreground">
                  Unable to load inventory data.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => refetch()}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Try Again
                </Button>
              </div>
            ) : overview ? (
              <>
                {/* Finished Goods */}
                {overview.finished_goods && overview.finished_goods.length > 0 && (
                  <FinishedGoodsSection
                    goods={overview.finished_goods}
                    lowStockThreshold={lowStockThreshold}
                  />
                )}

                {/* Batches In Progress */}
                {overview.batches_in_progress &&
                  overview.batches_in_progress.length > 0 && (
                    <BatchesInProgressSection batches={overview.batches_in_progress} />
                  )}

                {/* Raw Materials */}
                {overview.raw_materials && overview.raw_materials.length > 0 && (
                  <RawMaterialsSection materials={overview.raw_materials} />
                )}

                {/* Empty State */}
                {!overview.finished_goods?.length &&
                  !overview.batches_in_progress?.length &&
                  !overview.raw_materials?.length && (
                    <div className="text-center py-6 text-muted-foreground">
                      No inventory data available.
                    </div>
                  )}
              </>
            ) : null}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
