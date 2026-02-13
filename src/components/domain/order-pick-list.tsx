"use client";

/**
 * OrderPickList - Display and print pick list for order fulfillment
 *
 * Shows allocated finished goods with quantities and bin locations.
 * Mobile-optimized for warehouse tablet use.
 * Printable layout with order details.
 */

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { orderKeys } from "@/lib/query-keys";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Printer,
  Package,
  MapPin,
  Calendar,
  User,
  ClipboardList,
  CheckCircle2,
} from "lucide-react";
import { useState } from "react";

// =============================================================================
// Types
// =============================================================================

interface PickListItem {
  allocation_id: string;
  finished_good_id: string;
  lot_number: string;
  brand_name: string;
  package_name: string;
  quantity: number;
  bin_name: string | null;
  location_name: string | null;
  production_date: string | null;
}

interface OrderDetails {
  id: string;
  order_number: string;
  status: string;
  order_date: string;
  customer_name: string | null;
  scheduled_date: string | null;
}

interface OrderPickListProps {
  orderId: string;
}

// =============================================================================
// Component
// =============================================================================

export function OrderPickList({ orderId }: OrderPickListProps) {
  const supabase = createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const [pickedItems, setPickedItems] = useState<Set<string>>(new Set());

  // Fetch order details
  const { data: order, isLoading: orderLoading } = useQuery({
    queryKey: orderKeys.pickList(orderId, "order"),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select(`
          id,
          order_number,
          status,
          order_date,
          scheduled_date,
          customers:customer_id(name)
        `)
        .eq("id", orderId)
        .single();

      if (error) throw error;

      return {
        id: data.id,
        order_number: data.order_number,
        status: data.status,
        order_date: data.order_date,
        scheduled_date: data.scheduled_date,
        customer_name: (data.customers as { name: string } | null)?.name || null,
      } as OrderDetails;
    },
  });

  // Fetch allocations for this order
  const { data: pickItems = [], isLoading: itemsLoading } = useQuery({
    queryKey: orderKeys.pickList(orderId, "items"),
    queryFn: async () => {
      // Get allocations where destination is this order
      const { data: allocations, error: allocError } = await supabase
        .from("allocations")
        .select(`
          id,
          source_id,
          quantity,
          status
        `)
        .eq("destination_type", "order")
        .eq("destination_id", orderId)
        .in("status", ["planned", "completed"]);

      if (allocError) throw allocError;
      if (!allocations || allocations.length === 0) return [];

      // Get finished goods details
      const fgIds = allocations.map((a) => a.source_id).filter((id): id is string => !!id);
      const { data: finishedGoods, error: fgError } = await supabase
        .from("finished_goods")
        .select(`
          id,
          lot_number,
          brand_id,
          package_type_id,
          production_date
        `)
        .in("id", fgIds);

      if (fgError) throw fgError;

      // Get brands and package types
      const brandIds = [...new Set(finishedGoods?.map((fg) => fg.brand_id).filter((id): id is string => !!id))];
      const packageIds = [...new Set(finishedGoods?.map((fg) => fg.package_type_id).filter((id): id is string => !!id))];

      const [brandsResult, packagesResult, binInventoryResult] = await Promise.all([
        brandIds.length > 0
          ? supabase.from("brands").select("id, name").in("id", brandIds)
          : { data: [] },
        packageIds.length > 0
          ? supabase.from("package_types").select("id, name").in("id", packageIds)
          : { data: [] },
        db
          .from("bin_inventory")
          .select(`
            finished_good_id,
            quantity,
            bins:bin_id(name, locations:location_id(name))
          `)
          .in("finished_good_id", fgIds)
          .gt("quantity", 0),
      ]);

      const brandMap = new Map((brandsResult.data || []).map((b) => [b.id, b.name]));
      const packageMap = new Map((packagesResult.data || []).map((p) => [p.id, p.name]));

      const binInventory = binInventoryResult.data;

      // Create bin map (use first bin with inventory for each FG)
      const binMap = new Map<string, { bin_name: string; location_name: string }>();
      (binInventory || []).forEach((bi: { finished_good_id: string; bins: { name: string; locations: { name: string } | null } | null }) => {
        if (!binMap.has(bi.finished_good_id) && bi.bins) {
          binMap.set(bi.finished_good_id, {
            bin_name: bi.bins.name,
            location_name: bi.bins.locations?.name || "Unknown",
          });
        }
      });

      // Build pick list items
      const fgMap = new Map(finishedGoods?.map((fg) => [fg.id, fg]));

      return allocations
        .filter((a) => a.source_id && fgMap.has(a.source_id))
        .map((a) => {
          const fg = fgMap.get(a.source_id!)!;
          const binInfo = binMap.get(fg.id);

          return {
            allocation_id: a.id,
            finished_good_id: fg.id,
            lot_number: fg.lot_number || "N/A",
            brand_name: (fg.brand_id && brandMap.get(fg.brand_id)) || "Unknown",
            package_name: (fg.package_type_id && packageMap.get(fg.package_type_id)) || "Unknown",
            quantity: a.quantity,
            bin_name: binInfo?.bin_name || null,
            location_name: binInfo?.location_name || null,
            production_date: fg.production_date,
          } as PickListItem;
        })
        // Sort by location, then bin, then lot (for efficient picking)
        .sort((a, b) => {
          const locA = a.location_name || "ZZZ";
          const locB = b.location_name || "ZZZ";
          if (locA !== locB) return locA.localeCompare(locB);

          const binA = a.bin_name || "ZZZ";
          const binB = b.bin_name || "ZZZ";
          if (binA !== binB) return binA.localeCompare(binB);

          return a.lot_number.localeCompare(b.lot_number);
        });
    },
  });

  // Handle toggle picked
  const togglePicked = (allocationId: string) => {
    setPickedItems((prev) => {
      const next = new Set(prev);
      if (next.has(allocationId)) {
        next.delete(allocationId);
      } else {
        next.add(allocationId);
      }
      return next;
    });
  };

  // Handle print
  const handlePrint = () => {
    window.print();
  };

  const isLoading = orderLoading || itemsLoading;
  const totalItems = pickItems.length;
  const pickedCount = pickedItems.size;
  const totalQuantity = pickItems.reduce((sum, item) => sum + item.quantity, 0);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 print:space-y-4">
      {/* Header - hidden in print */}
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            Pick List
          </h2>
          <p className="text-muted-foreground">
            Order {order?.order_number}
          </p>
        </div>
        <Button onClick={handlePrint} variant="outline">
          <Printer className="h-4 w-4 mr-2" />
          Print
        </Button>
      </div>

      {/* Order Info Card */}
      <Card className="print:border-2 print:shadow-none">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">
              Order #{order?.order_number}
            </CardTitle>
            <Badge variant="outline" className="print:border-2">
              {order?.status}
            </Badge>
          </div>
          {order?.customer_name && (
            <CardDescription className="flex items-center gap-2">
              <User className="h-4 w-4" />
              {order.customer_name}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">Order Date</div>
              <div className="flex items-center gap-1 font-medium">
                <Calendar className="h-4 w-4" />
                {order?.order_date
                  ? new Date(order.order_date).toLocaleDateString()
                  : "—"}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Scheduled</div>
              <div className="flex items-center gap-1 font-medium">
                <Calendar className="h-4 w-4" />
                {order?.scheduled_date
                  ? new Date(order.scheduled_date).toLocaleDateString()
                  : "—"}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Items</div>
              <div className="font-medium">{totalItems} line items</div>
            </div>
            <div>
              <div className="text-muted-foreground">Total Qty</div>
              <div className="font-medium">{totalQuantity} units</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Progress - hidden in print */}
      <div className="flex items-center justify-between p-4 bg-muted rounded-lg print:hidden">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-500" />
          <span className="font-medium">Progress</span>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold">
            {pickedCount} / {totalItems}
          </div>
          <div className="text-sm text-muted-foreground">items picked</div>
        </div>
      </div>

      {/* Pick List Table */}
      {pickItems.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Package className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">No items allocated</p>
            <p className="text-muted-foreground">
              Allocate finished goods to this order first.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="print:border-2 print:shadow-none">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px] print:hidden">Pick</TableHead>
                <TableHead className="hidden print:table-cell w-[50px]">#</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Lot #</TableHead>
                <TableHead className="text-center">
                  <span className="flex items-center gap-1 justify-center">
                    <MapPin className="h-4 w-4" />
                    Location
                  </span>
                </TableHead>
                <TableHead className="text-right">Qty</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pickItems.map((item, index) => (
                <TableRow
                  key={item.allocation_id}
                  className={pickedItems.has(item.allocation_id) ? "bg-green-50 dark:bg-green-950/20" : ""}
                >
                  <TableCell className="print:hidden">
                    <Checkbox
                      checked={pickedItems.has(item.allocation_id)}
                      onCheckedChange={() => togglePicked(item.allocation_id)}
                      className="h-6 w-6"
                    />
                  </TableCell>
                  <TableCell className="hidden print:table-cell font-mono">
                    {index + 1}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{item.brand_name}</div>
                    <div className="text-sm text-muted-foreground">
                      {item.package_name}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="font-mono text-sm">{item.lot_number}</div>
                    {item.production_date && (
                      <div className="text-xs text-muted-foreground">
                        {new Date(item.production_date).toLocaleDateString()}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {item.bin_name ? (
                      <div>
                        <Badge variant="secondary" className="font-mono">
                          {item.bin_name}
                        </Badge>
                        {item.location_name && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {item.location_name}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="text-lg font-bold">{item.quantity}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Print Footer - only visible in print */}
      <div className="hidden print:block mt-8 pt-4 border-t text-sm text-muted-foreground">
        <div className="flex justify-between">
          <div>
            Picked by: ________________________
          </div>
          <div>
            Date: ________________________
          </div>
        </div>
        <div className="mt-4">
          Notes: ________________________________________________________________________
        </div>
      </div>
    </div>
  );
}
