"use client";

/**
 * SupplierGroupCard - Collapsible card for one supplier's shortfall items
 *
 * Shows supplier name, item count, total estimate, and a "Generate PO" button.
 * Rows show ingredient details with editable order quantities.
 */

import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { Input } from "@/components/ui/input";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  ShoppingCart,
} from "lucide-react";
import type { PODraft, POLineItemDraft } from "@/domain/purchasing/po-generator";
import { getCatalogTypeDisplay } from "@/domain/purchasing/demand-calculator";

// =============================================================================
// Types
// =============================================================================

type SupplierGroupCardProps = {
  draft: PODraft;
  hasUrgentItems: boolean;
  onQuantityChange: (catalogType: string, catalogId: string, qty: number) => void;
  onGeneratePO: (draft: PODraft) => Promise<void>;
  isGenerating: boolean;
}

// =============================================================================
// Component
// =============================================================================

export function SupplierGroupCard({
  draft,
  hasUrgentItems,
  onQuantityChange,
  onGeneratePO,
  isGenerating,
}: SupplierGroupCardProps) {
  const [isOpen, setIsOpen] = useState(true);

  const groupTotal = draft.line_items.reduce(
    (sum, item) => sum + (item.unit_price ? item.quantity * item.unit_price : 0),
    0
  );

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className={hasUrgentItems ? "border-destructive/50" : ""}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer select-none hover:bg-muted/50 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {isOpen ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
                <CardTitle className="text-base">{draft.supplier_name}</CardTitle>
                <Badge variant="secondary">
                  {draft.item_count} item{draft.item_count !== 1 ? "s" : ""}
                </Badge>
                {hasUrgentItems && (
                  <Badge variant="destructive">Urgent</Badge>
                )}
              </div>
              <div className="flex items-center gap-4">
                {groupTotal > 0 && (
                  <span className="text-sm text-muted-foreground font-medium">
                    Est. ${groupTotal.toFixed(2)}
                  </span>
                )}
                <Button
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onGeneratePO(draft);
                  }}
                  disabled={isGenerating}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <ShoppingCart className="h-4 w-4 mr-1" />
                      Generate PO
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0">
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ingredient</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Required</TableHead>
                    <TableHead className="text-right">Available</TableHead>
                    <TableHead className="text-right">On Order</TableHead>
                    <TableHead className="text-right">Shortfall</TableHead>
                    <TableHead className="text-right w-[140px]">Order Qty</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Unit Price</TableHead>
                    <TableHead className="text-right">Line Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {draft.line_items.map((item) => (
                    <LineItemRow
                      key={`${item.catalog_type}-${item.catalog_id}`}
                      item={item}
                      onQuantityChange={(qty) =>
                        onQuantityChange(item.catalog_type, item.catalog_id, qty)
                      }
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// =============================================================================
// Line Item Row
// =============================================================================

function LineItemRow({
  item,
  onQuantityChange,
}: {
  item: POLineItemDraft;
  onQuantityChange: (qty: number) => void;
}) {
  const lineTotal = item.unit_price ? item.quantity * item.unit_price : null;

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2">
          <span className="font-medium">{item.catalog_name}</span>
          {item.is_urgent && <Badge variant="destructive" className="text-xs">Urgent</Badge>}
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="outline">
          {getCatalogTypeDisplay(item.catalog_type)}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        {item.total_required.toLocaleString(undefined, { maximumFractionDigits: 2 })}
      </TableCell>
      <TableCell className="text-right text-muted-foreground">
        {item.available_qty.toLocaleString(undefined, { maximumFractionDigits: 2 })}
      </TableCell>
      <TableCell className="text-right text-muted-foreground">
        {item.on_order_qty > 0
          ? item.on_order_qty.toLocaleString(undefined, { maximumFractionDigits: 2 })
          : "-"}
      </TableCell>
      <TableCell className="text-right">
        <Badge variant="secondary">
          {item.shortfall_qty.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        <Input
          type="number"
          step="0.01"
          min={0}
          value={item.quantity}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            if (!isNaN(val) && val > 0) {
              onQuantityChange(val);
            }
          }}
          className="w-[120px] text-right ml-auto"
        />
      </TableCell>
      <TableCell className="text-muted-foreground">{item.unit}</TableCell>
      <TableCell className="text-right text-muted-foreground">
        {item.unit_price ? `$${item.unit_price.toFixed(2)}` : "-"}
      </TableCell>
      <TableCell className="text-right font-medium">
        {lineTotal ? `$${lineTotal.toFixed(2)}` : "-"}
      </TableCell>
    </TableRow>
  );
}
