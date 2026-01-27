"use client";

/**
 * IngredientShortfallsTable - Table showing ingredient shortfalls
 *
 * Displays ingredients where demand exceeds inventory, with:
 * - Required vs available quantities
 * - Preferred supplier info
 * - Order by date for timely ordering
 * - Create PO action
 */

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Plus, Package, RefreshCw } from "lucide-react";
import type { IngredientShortfall } from "@/lib/purchasing/demand-calculator";
import { getCatalogTypeDisplay, formatQuantityWithUnit } from "@/lib/purchasing/demand-calculator";
import { CreatePOFromShortfall } from "./create-po-from-shortfall";

// =============================================================================
// Types
// =============================================================================

interface IngredientShortfallsTableProps {
  shortfalls: IngredientShortfall[];
  isLoading?: boolean;
  onPOCreated?: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function IngredientShortfallsTable({
  shortfalls,
  isLoading = false,
  onPOCreated,
}: IngredientShortfallsTableProps) {
  const [selectedShortfall, setSelectedShortfall] = useState<IngredientShortfall | null>(null);

  // Format date for display
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  // Check if date is past or within 3 days (urgent)
  const isPastOrSoon = (dateStr: string) => {
    const date = new Date(dateStr);
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
    return date <= threeDaysFromNow;
  };

  // Handle PO creation success
  const handlePOCreated = () => {
    setSelectedShortfall(null);
    onPOCreated?.();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (shortfalls.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p className="text-lg font-medium">No shortfalls detected</p>
        <p className="text-sm">
          All ingredient demand is covered by available inventory
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ingredient</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Required</TableHead>
              <TableHead className="text-right">Available</TableHead>
              <TableHead className="text-right">Shortfall</TableHead>
              <TableHead>Order By</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shortfalls.map((shortfall, index) => (
              <TableRow key={`${shortfall.catalog_type}-${shortfall.catalog_id}-${index}`}>
                <TableCell>
                  <div className="font-medium">{shortfall.catalog_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {shortfall.batch_count} batch{shortfall.batch_count !== 1 ? "es" : ""}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {getCatalogTypeDisplay(shortfall.catalog_type)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-medium">
                  {formatQuantityWithUnit(shortfall.total_required, shortfall.unit)}
                </TableCell>
                <TableCell className="text-right">
                  {formatQuantityWithUnit(shortfall.available_qty, shortfall.unit)}
                </TableCell>
                <TableCell className="text-right">
                  <Badge variant={shortfall.is_urgent ? "destructive" : "secondary"}>
                    {formatQuantityWithUnit(shortfall.shortfall_qty, shortfall.unit)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {shortfall.is_urgent && (
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                    )}
                    <span
                      className={
                        isPastOrSoon(shortfall.order_by_date)
                          ? "text-destructive font-medium"
                          : ""
                      }
                    >
                      {formatDate(shortfall.order_by_date)}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {shortfall.lead_time_days} day lead time
                  </div>
                </TableCell>
                <TableCell>
                  {shortfall.preferred_supplier_name ? (
                    <div>
                      <div className="font-medium text-sm">
                        {shortfall.preferred_supplier_name}
                      </div>
                      {shortfall.unit_price && (
                        <div className="text-xs text-muted-foreground">
                          ${shortfall.unit_price.toFixed(2)}/{shortfall.unit}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-sm">No supplier</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant={shortfall.is_urgent ? "destructive" : "outline"}
                    onClick={() => setSelectedShortfall(shortfall)}
                    disabled={!shortfall.preferred_supplier_id}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Create PO
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Create PO Dialog */}
      {selectedShortfall && (
        <CreatePOFromShortfall
          shortfall={selectedShortfall}
          open={!!selectedShortfall}
          onOpenChange={(open) => !open && setSelectedShortfall(null)}
          onSuccess={handlePOCreated}
        />
      )}
    </>
  );
}
