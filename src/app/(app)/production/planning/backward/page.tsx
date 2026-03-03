"use client";

/**
 * Backward Planning Page
 *
 * Shows demand from orders and calculates production requirements.
 * Groups demand by product/package and identifies shortages.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { planningKeys } from "@/lib/query-keys";
import {
  getOrderDemand,
  getProductionRequirements,
  formatPlanningDate,
  getProductDisplayName,
  type OrderDemand,
  type ProductionRequirement,
} from "@/lib/planning";
import { StatsStrip, DashboardSection } from "@/components/dashboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { RefreshCw, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

// =============================================================================
// Component
// =============================================================================

export default function BackwardPlanningPage() {
  // State
  const [horizonWeeks, setHorizonWeeks] = useState(8);
  const [ordersOpen, setOrdersOpen] = useState(false);

  // Fetch order demand
  const {
    data: orders = [],
    isLoading: ordersLoading,
    refetch: refetchOrders,
  } = useQuery({
    queryKey: planningKeys.orderDemand(horizonWeeks),
    queryFn: () => getOrderDemand(horizonWeeks),
    refetchInterval: 60000,
  });

  // Fetch production requirements
  const {
    data: requirements = [],
    isLoading: requirementsLoading,
    refetch: refetchRequirements,
  } = useQuery({
    queryKey: planningKeys.productionRequirements(horizonWeeks),
    queryFn: () => getProductionRequirements(horizonWeeks),
    refetchInterval: 60000,
  });

  const isLoading = ordersLoading || requirementsLoading;

  // Calculate summary stats
  const totalLineItems = orders.reduce((sum, o) => sum + o.items.length, 0);
  const tbdItems = orders.reduce(
    (sum, o) => sum + o.items.filter((i) => i.is_tbd).length,
    0
  );
  const shortageCount = requirements.filter((r) => r.shortage > 0).length;

  const handleRefresh = () => {
    refetchOrders();
    refetchRequirements();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold">Backward Planning</h1>
            <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5 text-sm">
              <Link href="/production/planning">
                <Button variant="ghost" size="sm" className="h-7 px-3 text-muted-foreground hover:text-foreground">
                  Shortfalls
                </Button>
              </Link>
              <Button variant="ghost" size="sm" className="h-7 px-3 bg-background shadow-sm">
                Orders
              </Button>
              <Link href="/production/planning/timeline">
                <Button variant="ghost" size="sm" className="h-7 px-3 text-muted-foreground hover:text-foreground">
                  Timeline
                </Button>
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Select
              value={horizonWeeks.toString()}
              onValueChange={(value) => setHorizonWeeks(parseInt(value))}
            >
              <SelectTrigger className="w-[120px] h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="4">4 weeks</SelectItem>
                <SelectItem value="8">8 weeks</SelectItem>
                <SelectItem value="12">12 weeks</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* Stats strip */}
        <StatsStrip
          stats={[
            { value: orders.length, label: "orders" },
            { value: totalLineItems, label: "line items" },
            ...(tbdItems > 0
              ? [{ value: tbdItems, label: "TBD items" }]
              : []),
            ...(shortageCount > 0
              ? [{ value: shortageCount, label: "shortages", variant: "warning" as const }]
              : []),
          ]}
        />
      </div>

      {/* Production Requirements Table */}
      <DashboardSection title="Production Requirements">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : requirements.length === 0 ? (
          <p className="text-sm text-muted-foreground py-12 text-center">
            No open orders within {horizonWeeks} weeks
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="uppercase tracking-wider text-xs">Product</TableHead>
                <TableHead className="uppercase tracking-wider text-xs">Package</TableHead>
                <TableHead className="uppercase tracking-wider text-xs text-right">Demand</TableHead>
                <TableHead className="uppercase tracking-wider text-xs text-right">Available</TableHead>
                <TableHead className="uppercase tracking-wider text-xs text-right">Shortage</TableHead>
                <TableHead className="uppercase tracking-wider text-xs">Target Date</TableHead>
                <TableHead className="uppercase tracking-wider text-xs text-right">Orders</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requirements.map((req, index) => (
                <RequirementRow key={getRequirementKey(req, index)} requirement={req} />
              ))}
            </TableBody>
          </Table>
        )}
      </DashboardSection>

      {/* Order Details (Collapsible) */}
      <Collapsible open={ordersOpen} onOpenChange={setOrdersOpen}>
        <div className="rounded-lg border bg-card p-4">
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-2 hover:text-foreground transition-colors w-full text-left mb-4">
              {ordersOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              <span className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                Order Details
              </span>
              <Badge variant="secondary" className="ml-2">
                {orders.length}
              </Badge>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            {ordersLoading ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : orders.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No open orders
              </p>
            ) : (
              <div className="space-y-4">
                {orders.map((order) => (
                  <OrderCard key={order.order_id} order={order} />
                ))}
              </div>
            )}
          </CollapsibleContent>
        </div>
      </Collapsible>
    </div>
  );
}

// =============================================================================
// Helper Components
// =============================================================================

function RequirementRow({ requirement }: { requirement: ProductionRequirement }) {
  const hasShortage = requirement.shortage > 0;
  const productName = getProductDisplayName(requirement);

  return (
    <TableRow className={cn(hasShortage && "bg-amber-50/50")}>
      <TableCell>
        <div className={cn("font-medium", requirement.is_tbd && "italic text-muted-foreground")}>
          {productName}
        </div>
        {requirement.is_tbd && requirement.order_numbers.length > 0 && (
          <div className="text-xs text-muted-foreground">
            {requirement.order_numbers.slice(0, 2).join(", ")}
            {requirement.order_numbers.length > 2 && ` +${requirement.order_numbers.length - 2}`}
          </div>
        )}
      </TableCell>
      <TableCell className="text-sm">
        {requirement.selling_format_name || "—"}
      </TableCell>
      <TableCell className="text-right font-mono">
        {requirement.total_demand.toLocaleString()}
      </TableCell>
      <TableCell className="text-right font-mono">
        {requirement.available_quantity.toLocaleString()}
      </TableCell>
      <TableCell className="text-right">
        {hasShortage ? (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3 w-3" />
            {requirement.shortage.toLocaleString()}
          </Badge>
        ) : (
          <Badge variant="secondary">OK</Badge>
        )}
      </TableCell>
      <TableCell className="text-sm">
        {formatPlanningDate(requirement.earliest_requested_date)}
        {requirement.earliest_requested_date !== requirement.latest_requested_date &&
          requirement.latest_requested_date && (
            <span className="text-muted-foreground text-xs block">
              to {formatPlanningDate(requirement.latest_requested_date)}
            </span>
          )}
      </TableCell>
      <TableCell className="text-right">
        <Badge variant="outline">{requirement.order_count}</Badge>
      </TableCell>
    </TableRow>
  );
}

function OrderCard({ order }: { order: OrderDemand }) {
  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <Link
            href={`/sales/orders/${order.order_id}`}
            className="font-medium hover:underline"
          >
            {order.order_number}
          </Link>
          {order.customer_name && (
            <span className="text-muted-foreground ml-2">
              - {order.customer_name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>Requested: {formatPlanningDate(order.requested_date)}</span>
          <Badge variant="secondary">{order.status}</Badge>
        </div>
      </div>

      {order.items.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Product</TableHead>
              <TableHead className="text-xs">Package</TableHead>
              <TableHead className="text-xs text-right">Qty</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {order.items.map((item) => (
              <TableRow key={item.item_id}>
                <TableCell>
                  {item.is_tbd ? (
                    <span className="italic text-muted-foreground">
                      TBD: {item.style_name || "Unknown Style"}
                      {item.tbd_notes && (
                        <span className="text-xs block">{item.tbd_notes}</span>
                      )}
                    </span>
                  ) : (
                    item.brand_name || "—"
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  {item.selling_format_name || "—"}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {item.quantity.toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-sm text-muted-foreground">No items</p>
      )}
    </div>
  );
}

// =============================================================================
// Utilities
// =============================================================================

function getRequirementKey(req: ProductionRequirement, index: number): string {
  if (req.is_tbd) {
    return `tbd-${req.style_id}-${req.selling_format_id}-${index}`;
  }
  return `brand-${req.brand_id}-${req.selling_format_id}-${index}`;
}
