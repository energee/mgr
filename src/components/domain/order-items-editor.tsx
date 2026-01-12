"use client";

/**
 * OrderItemsEditor - Order Line Items Management Component
 *
 * Manages order line items with brand + package type selection.
 * Features:
 * - Brand selector (what product)
 * - Package type selector (what format)
 * - Quantity and unit price inputs
 * - Line total calculation
 * - Order total display
 */

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";

// Types
export interface OrderItem {
  id?: string;
  brand_id: string | null;
  package_type_id: string | null;
  quantity: number;
  unit_price: number | null;
  notes: string | null;
  // Joined data (for display)
  brand?: { id: string; name: string; abv: number | null };
  package_type?: { id: string; name: string; container_type: string; volume_oz: number };
}

interface Brand {
  id: string;
  name: string;
  abv: number | null;
}

interface PackageType {
  id: string;
  name: string;
  container_type: string;
  volume_oz: number;
}

interface OrderItemsEditorProps {
  /** Current order items */
  items: OrderItem[];
  /** Callback when items change */
  onChange: (items: OrderItem[]) => void;
  /** Whether the editor is disabled */
  disabled?: boolean;
  /** Order ID for context */
  orderId?: string;
}

export function OrderItemsEditor({
  items,
  onChange,
  disabled = false,
}: OrderItemsEditorProps) {
  const supabase = createClient();

  // Fetch brands
  const { data: brands = [], isLoading: loadingBrands } = useQuery({
    queryKey: ["brands-catalog"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brands")
        .select("id, name, abv")
        .order("name");
      if (error) throw error;
      return data as Brand[];
    },
  });

  // Fetch package types
  const { data: packageTypes = [], isLoading: loadingPackageTypes } = useQuery({
    queryKey: ["package-types-catalog"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("package_types")
        .select("id, name, container_type, volume_oz")
        .eq("is_active", true)
        .order("container_type")
        .order("name");
      if (error) throw error;
      return data as PackageType[];
    },
  });

  // Calculate order totals
  const totals = useMemo(() => {
    const totalUnits = items.reduce((sum, item) => sum + (item.quantity || 0), 0);
    const orderTotal = items.reduce((sum, item) => {
      const lineTotal = (item.quantity || 0) * (item.unit_price || 0);
      return sum + lineTotal;
    }, 0);
    return { totalUnits, orderTotal };
  }, [items]);

  // Add a new empty line item
  const handleAddItem = useCallback(() => {
    const newItem: OrderItem = {
      brand_id: null,
      package_type_id: null,
      quantity: 1,
      unit_price: null,
      notes: null,
    };
    onChange([...items, newItem]);
  }, [items, onChange]);

  // Update a field on an item
  const handleUpdateItem = useCallback(
    (index: number, field: keyof OrderItem, value: unknown) => {
      const updated = [...items];
      updated[index] = { ...updated[index], [field]: value };

      // If brand changed, update the joined data for display
      if (field === "brand_id") {
        const brand = brands.find((b) => b.id === value);
        updated[index].brand = brand;
      }
      if (field === "package_type_id") {
        const pt = packageTypes.find((p) => p.id === value);
        updated[index].package_type = pt;
      }

      onChange(updated);
    },
    [items, onChange, brands, packageTypes]
  );

  // Remove an item
  const handleRemoveItem = useCallback(
    (index: number) => {
      const updated = items.filter((_, i) => i !== index);
      onChange(updated);
    },
    [items, onChange]
  );

  // Group package types by container type
  const packageTypesByContainer = useMemo(() => {
    const groups: Record<string, PackageType[]> = {};
    packageTypes.forEach((pt) => {
      const type = pt.container_type || "other";
      if (!groups[type]) groups[type] = [];
      groups[type].push(pt);
    });
    return groups;
  }, [packageTypes]);

  const containerLabels: Record<string, string> = {
    can: "Cans",
    bottle: "Bottles",
    keg: "Kegs",
    growler: "Growlers",
    other: "Other",
  };

  const isLoading = loadingBrands || loadingPackageTypes;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Line Items</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAddItem}
          disabled={disabled || isLoading}
          className="gap-1"
        >
          <Plus className="h-4 w-4" />
          Add Item
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="border rounded-md p-8 text-center text-muted-foreground">
          <p>No line items added yet.</p>
          <p className="text-sm mt-1">Click &quot;Add Item&quot; to add products to this order.</p>
        </div>
      ) : (
        <div className="border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[200px]">Brand</TableHead>
                <TableHead className="w-[180px]">Package</TableHead>
                <TableHead className="w-[100px] text-right">Qty</TableHead>
                <TableHead className="w-[120px] text-right">Unit Price</TableHead>
                <TableHead className="w-[120px] text-right">Line Total</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, index) => {
                const lineTotal = (item.quantity || 0) * (item.unit_price || 0);

                return (
                  <TableRow key={item.id || index}>
                    <TableCell>
                      <Select
                        value={item.brand_id || ""}
                        onValueChange={(value) =>
                          handleUpdateItem(index, "brand_id", value || null)
                        }
                        disabled={disabled}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select brand..." />
                        </SelectTrigger>
                        <SelectContent>
                          {brands.map((brand) => (
                            <SelectItem key={brand.id} value={brand.id}>
                              {brand.name}
                              {brand.abv && (
                                <span className="text-muted-foreground ml-1">
                                  ({brand.abv}%)
                                </span>
                              )}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={item.package_type_id || ""}
                        onValueChange={(value) =>
                          handleUpdateItem(index, "package_type_id", value || null)
                        }
                        disabled={disabled}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select package..." />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(packageTypesByContainer).map(
                            ([containerType, types]) => (
                              <div key={containerType}>
                                <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">
                                  {containerLabels[containerType] || containerType}
                                </div>
                                {types.map((pt) => (
                                  <SelectItem key={pt.id} value={pt.id}>
                                    {pt.name}
                                  </SelectItem>
                                ))}
                              </div>
                            )
                          )}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        value={item.quantity || ""}
                        onChange={(e) =>
                          handleUpdateItem(
                            index,
                            "quantity",
                            parseInt(e.target.value) || 0
                          )
                        }
                        disabled={disabled}
                        className="w-20 text-right ml-auto"
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <span className="text-muted-foreground">$</span>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.unit_price ?? ""}
                          onChange={(e) =>
                            handleUpdateItem(
                              index,
                              "unit_price",
                              parseFloat(e.target.value) || null
                            )
                          }
                          disabled={disabled}
                          className="w-24 text-right"
                          placeholder="0.00"
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      ${lineTotal.toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveItem(index)}
                        disabled={disabled}
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2} className="font-medium">
                  Order Total
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {totals.totalUnits} units
                </TableCell>
                <TableCell></TableCell>
                <TableCell className="text-right font-bold text-lg tabular-nums">
                  ${totals.orderTotal.toFixed(2)}
                </TableCell>
                <TableCell></TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}

      {/* Validation warnings */}
      {items.length > 0 && <OrderItemsWarnings items={items} />}
    </div>
  );
}

// Component for showing order item warnings
function OrderItemsWarnings({ items }: { items: OrderItem[] }) {
  const warnings: string[] = [];

  // Check for items without brand
  const missingBrand = items.filter((item) => !item.brand_id);
  if (missingBrand.length > 0) {
    warnings.push(
      `${missingBrand.length} item(s) missing brand selection.`
    );
  }

  // Check for items without package type
  const missingPackage = items.filter((item) => !item.package_type_id);
  if (missingPackage.length > 0) {
    warnings.push(
      `${missingPackage.length} item(s) missing package type.`
    );
  }

  // Check for items with 0 quantity
  const zeroQuantity = items.filter((item) => !item.quantity || item.quantity === 0);
  if (zeroQuantity.length > 0) {
    warnings.push(`${zeroQuantity.length} item(s) have zero quantity.`);
  }

  // Check for items without price
  const missingPrice = items.filter((item) => item.unit_price === null || item.unit_price === undefined);
  if (missingPrice.length > 0) {
    warnings.push(
      `${missingPrice.length} item(s) missing unit price.`
    );
  }

  if (warnings.length === 0) return null;

  return (
    <div className="text-sm text-amber-600 dark:text-amber-400 space-y-1">
      {warnings.map((warning, i) => (
        <p key={i}>Warning: {warning}</p>
      ))}
    </div>
  );
}
