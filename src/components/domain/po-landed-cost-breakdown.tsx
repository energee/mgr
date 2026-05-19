"use client";

/**
 * PO Landed Cost Breakdown
 *
 * Displays a per-line-item breakdown of landed costs for a purchase order.
 * Shows unit price, allocated shipping, landed cost per unit, and markup
 * for each line item, with totals at the bottom.
 *
 * Uses `getLandedCostSummary()` which calls the `calculate_landed_cost` RPC.
 * The query is configured with `staleTime: Infinity` since recalculation
 * is triggered explicitly via the "Calculate Landed Cost" action.
 */

import { useQuery } from "@tanstack/react-query";
import { landedCostKeys } from "@/lib/query-keys";
import {
  getLandedCostSummary,
  formatLandedCost,
  landedCostMarkup,
} from "@/domain/purchasing/landed-cost";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Calculator } from "lucide-react";
import { getCatalogTypeLabel } from "@/entities/po-line-item";

// =============================================================================
// Types
// =============================================================================

type PoLandedCostBreakdownProps = {
  /** The purchase order ID to display landed cost breakdown for */
  poId: string;
};

// =============================================================================
// Helpers
// =============================================================================

/**
 * Format a markup percentage for display.
 */
function formatMarkup(markup: number | null): string {
  if (markup == null) return "--";
  return `${markup >= 0 ? "+" : ""}${markup.toFixed(1)}%`;
}

// =============================================================================
// Component
// =============================================================================

export function PoLandedCostBreakdown({ poId }: PoLandedCostBreakdownProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: landedCostKeys.summary(poId),
    queryFn: () => getLandedCostSummary(poId),
    staleTime: Infinity,
  });

  if (isLoading) {
    return (
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Landed Cost Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Landed Cost Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Failed to load landed cost data.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.line_items.length === 0) {
    return (
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Landed Cost Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No inventory lots linked yet. Accept items into inventory before
            calculating landed cost.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calculator className="h-5 w-5" />
          Landed Cost Breakdown
        </CardTitle>
        {(data.shipping_cost > 0 || data.tax > 0) && (
          <p className="text-sm text-muted-foreground">
            {[
              data.shipping_cost > 0
                ? `Shipping ${formatLandedCost(data.shipping_cost)}`
                : null,
              data.tax > 0
                ? `Tax ${formatLandedCost(data.tax)}`
                : null,
            ]
              .filter(Boolean)
              .join(" + ")}{" "}
            allocated proportionally by line item value.
          </p>
        )}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Unit Price</TableHead>
              <TableHead className="text-right">Alloc. Shipping</TableHead>
              <TableHead className="text-right">Alloc. Tax</TableHead>
              <TableHead className="text-right">Landed Cost/Unit</TableHead>
              <TableHead className="text-right">Markup</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.line_items.map((item, index) => {
              const markup = landedCostMarkup(
                item.landed_cost_per_unit,
                item.unit_price ?? 0
              );

              return (
                <TableRow key={item.line_item_id ?? index}>
                  <TableCell className="font-medium">
                    {getCatalogTypeLabel(item.catalog_type)}
                  </TableCell>
                  <TableCell className="text-right">{item.quantity}</TableCell>
                  <TableCell className="text-right">
                    {formatLandedCost(item.unit_price)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatLandedCost(item.allocated_shipping)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatLandedCost(item.allocated_tax)}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatLandedCost(item.landed_cost_per_unit)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatMarkup(markup)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2} className="font-medium">
                Totals
              </TableCell>
              <TableCell className="text-right font-medium">
                {formatLandedCost(data.total_item_cost)}
              </TableCell>
              <TableCell className="text-right font-medium">
                {formatLandedCost(data.shipping_cost)}
              </TableCell>
              <TableCell className="text-right font-medium">
                {formatLandedCost(data.tax)}
              </TableCell>
              <TableCell className="text-right font-medium">
                {formatLandedCost(data.total_landed_cost)}
              </TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  );
}
