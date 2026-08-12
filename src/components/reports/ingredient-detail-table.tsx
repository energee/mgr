"use client";

/**
 * Ingredient-level allocation cost detail for a single batch.
 *
 * Rendered inside an `ExpandedDetailRow` by the COGS and Batch Cost Analysis
 * reports when a batch row is expanded. Lives outside `report-page.tsx` on
 * purpose: that module is a domain-blind layout kit (page frame, filter card,
 * summary cards, generic table), whereas this table knows what an ingredient
 * allocation, a lot number and a unit cost are.
 */

import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";
import type { IngredientCostRow } from "@/domain/report-utils";

/**
 * Ingredient-level allocation cost detail for one batch, shared by the COGS
 * and Batch Cost Analysis expandable rows.
 */
export function IngredientDetailTable({
  loading,
  rows,
}: {
  loading: boolean;
  rows: IngredientCostRow[] | undefined;
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }
  if (!rows || rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No ingredient allocations found for this batch
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Ingredient</TableHead>
          <TableHead>Lot #</TableHead>
          <TableHead className="text-right">Quantity</TableHead>
          <TableHead className="text-right">Unit Cost</TableHead>
          <TableHead className="text-right">Total Cost</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.allocation_id}>
            <TableCell>{row.ingredient_name}</TableCell>
            <TableCell className="text-muted-foreground font-mono text-sm">
              {row.lot_number ?? "--"}
            </TableCell>
            <TableCell className="text-right font-mono">
              {row.quantity.toFixed(2)}
            </TableCell>
            <TableCell className="text-right font-mono">
              {formatCurrency(row.unit_cost)}
            </TableCell>
            <TableCell className="text-right font-mono font-medium">
              {formatCurrency(row.total_cost)}
            </TableCell>
          </TableRow>
        ))}
        <TableRow className="font-bold border-t-2">
          <TableCell colSpan={4}>Total</TableCell>
          <TableCell className="text-right font-mono">
            {formatCurrency(rows.reduce((sum, r) => sum + r.total_cost, 0))}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}
