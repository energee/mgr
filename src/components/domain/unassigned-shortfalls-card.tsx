"use client";

/**
 * UnassignedShortfallsCard - Card for shortfall items without a preferred supplier
 *
 * Shows same table columns as SupplierGroupCard but with a supplier dropdown per row
 * so users can assign a supplier before generating POs.
 */

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { supplierKeys } from "@/lib/query-keys";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import type { IngredientShortfall } from "@/lib/purchasing/demand-calculator";
import { getCatalogTypeDisplay } from "@/lib/purchasing/demand-calculator";

// =============================================================================
// Types
// =============================================================================

interface UnassignedShortfallsCardProps {
  shortfalls: IngredientShortfall[];
  onAssignSupplier: (
    catalogType: string,
    catalogId: string,
    supplierId: string,
    supplierName: string
  ) => void;
}

// =============================================================================
// Component
// =============================================================================

export function UnassignedShortfallsCard({
  shortfalls,
  onAssignSupplier,
}: UnassignedShortfallsCardProps) {
  const supabase = createClient();

  const { data: suppliers = [] } = useQuery({
    queryKey: supplierKeys.active(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  if (shortfalls.length === 0) return null;

  return (
    <Card className="border-amber-500/50">
      <CardHeader>
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          <div>
            <CardTitle className="text-base">Unassigned Items</CardTitle>
            <CardDescription>
              {shortfalls.length} item{shortfalls.length !== 1 ? "s" : ""} without
              a preferred supplier. Assign a supplier to include in PO generation.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ingredient</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Required</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead className="text-right">Shortfall</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="w-[200px]">Assign Supplier</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shortfalls.map((shortfall) => (
                <TableRow key={`${shortfall.catalog_type}-${shortfall.catalog_id}`}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{shortfall.catalog_name}</span>
                      {shortfall.is_urgent && (
                        <Badge variant="destructive" className="text-xs">Urgent</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {getCatalogTypeDisplay(shortfall.catalog_type)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {shortfall.total_required.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {shortfall.available_qty.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="secondary">
                      {shortfall.shortfall_qty.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{shortfall.unit}</TableCell>
                  <TableCell>
                    <Select
                      onValueChange={(supplierId) => {
                        const supplier = suppliers.find((s) => s.id === supplierId);
                        if (supplier) {
                          onAssignSupplier(
                            shortfall.catalog_type,
                            shortfall.catalog_id,
                            supplier.id,
                            supplier.name
                          );
                        }
                      }}
                    >
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Select supplier..." />
                      </SelectTrigger>
                      <SelectContent>
                        {suppliers.map((supplier) => (
                          <SelectItem key={supplier.id} value={supplier.id}>
                            {supplier.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
