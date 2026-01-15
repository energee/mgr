"use client";

/**
 * Session Line Items Editor
 *
 * Inline editor for packaging session line items. Each line item represents
 * a product (brand + package type) being packaged with planned/actual quantities.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
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
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

// =============================================================================
// Types
// =============================================================================

interface SessionLineItemRow {
  id: string;
  brand_id: string;
  brand_name: string;
  package_type_id: string;
  package_type_name: string;
  planned_quantity: number | null;
  actual_quantity: number | null;
}

interface SessionLineItemsEditorProps {
  sessionId: string;
  readOnly?: boolean;
}

interface NewItemState {
  brand_id: string;
  package_type_id: string;
  planned_quantity: number | null;
  actual_quantity: number | null;
}

interface Brand {
  id: string;
  name: string;
}

interface PackageType {
  id: string;
  name: string;
}

// =============================================================================
// Component
// =============================================================================

export function SessionLineItemsEditor({
  sessionId,
  readOnly = false,
}: SessionLineItemsEditorProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  // New item form state
  const [newItem, setNewItem] = useState<NewItemState>({
    brand_id: "",
    package_type_id: "",
    planned_quantity: null,
    actual_quantity: null,
  });
  const [showAddRow, setShowAddRow] = useState(false);

  // Fetch session line items with resolved names
  const { data: items, isLoading: itemsLoading } = useQuery({
    queryKey: ["session-line-items", sessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("session_line_items")
        .select("*, brands(name), package_types(name)")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true });
      if (error) throw error;

      return data.map((item) => ({
        id: item.id,
        brand_id: item.brand_id,
        brand_name: (item.brands as { name: string } | null)?.name || "Unknown",
        package_type_id: item.package_type_id,
        package_type_name:
          (item.package_types as { name: string } | null)?.name || "Unknown",
        planned_quantity: item.planned_quantity,
        actual_quantity: item.actual_quantity,
      })) as SessionLineItemRow[];
    },
  });

  // Fetch brands
  const { data: brands } = useQuery({
    queryKey: ["brands"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brands")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as Brand[];
    },
  });

  // Fetch package types
  const { data: packageTypes } = useQuery({
    queryKey: ["package-types"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("package_types")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as PackageType[];
    },
  });

  // Add item mutation
  const addItem = useMutation({
    mutationFn: async (item: NewItemState) => {
      const { error } = await supabase.from("session_line_items").insert({
        session_id: sessionId,
        brand_id: item.brand_id,
        package_type_id: item.package_type_id,
        planned_quantity: item.planned_quantity,
        actual_quantity: item.actual_quantity,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["session-line-items", sessionId] });
      setNewItem({
        brand_id: "",
        package_type_id: "",
        planned_quantity: null,
        actual_quantity: null,
      });
      setShowAddRow(false);
      toast.success("Line item added");
    },
    onError: () => {
      toast.error("Failed to add line item");
    },
  });

  // Update item mutation
  const updateItem = useMutation({
    mutationFn: async ({
      id,
      field,
      value,
    }: {
      id: string;
      field: string;
      value: unknown;
    }) => {
      const { error } = await supabase
        .from("session_line_items")
        .update({ [field]: value })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["session-line-items", sessionId] });
    },
    onError: () => {
      toast.error("Failed to update line item");
    },
  });

  // Delete item mutation
  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("session_line_items")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["session-line-items", sessionId] });
      toast.success("Line item removed");
    },
    onError: () => {
      toast.error("Failed to remove line item");
    },
  });

  // Calculate totals
  const totalPlanned =
    items?.reduce((sum, item) => sum + (item.planned_quantity || 0), 0) || 0;
  const totalActual =
    items?.reduce((sum, item) => sum + (item.actual_quantity || 0), 0) || 0;

  // Handle add item
  const handleAdd = () => {
    if (!newItem.brand_id) {
      toast.error("Please select a brand");
      return;
    }
    if (!newItem.package_type_id) {
      toast.error("Please select a package type");
      return;
    }
    addItem.mutate(newItem);
  };

  if (itemsLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Line Items</h3>
        {!readOnly && !showAddRow && (
          <Button size="sm" variant="outline" onClick={() => setShowAddRow(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Line Item
          </Button>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Brand</TableHead>
            <TableHead>Package Type</TableHead>
            <TableHead className="w-[120px]">Planned Qty</TableHead>
            <TableHead className="w-[120px]">Actual Qty</TableHead>
            {!readOnly && <TableHead className="w-[60px]" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items?.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="font-medium">{item.brand_name}</TableCell>
              <TableCell>{item.package_type_name}</TableCell>
              <TableCell>
                {readOnly ? (
                  item.planned_quantity ?? "—"
                ) : (
                  <Input
                    type="number"
                    min={0}
                    value={item.planned_quantity ?? ""}
                    onChange={(e) =>
                      updateItem.mutate({
                        id: item.id,
                        field: "planned_quantity",
                        value: e.target.value ? parseInt(e.target.value) : null,
                      })
                    }
                    className="h-8 w-full"
                    placeholder="—"
                  />
                )}
              </TableCell>
              <TableCell>
                {readOnly ? (
                  item.actual_quantity ?? "—"
                ) : (
                  <Input
                    type="number"
                    min={0}
                    value={item.actual_quantity ?? ""}
                    onChange={(e) =>
                      updateItem.mutate({
                        id: item.id,
                        field: "actual_quantity",
                        value: e.target.value ? parseInt(e.target.value) : null,
                      })
                    }
                    className="h-8 w-full"
                    placeholder="—"
                  />
                )}
              </TableCell>
              {!readOnly && (
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    onClick={() => deleteItem.mutate(item.id)}
                    disabled={deleteItem.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}

          {/* Add new item row */}
          {showAddRow && (
            <TableRow>
              <TableCell>
                <Select
                  value={newItem.brand_id}
                  onValueChange={(value) =>
                    setNewItem({ ...newItem, brand_id: value })
                  }
                >
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Select brand" />
                  </SelectTrigger>
                  <SelectContent>
                    {brands?.map((brand) => (
                      <SelectItem key={brand.id} value={brand.id}>
                        {brand.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Select
                  value={newItem.package_type_id}
                  onValueChange={(value) =>
                    setNewItem({ ...newItem, package_type_id: value })
                  }
                >
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Select package type" />
                  </SelectTrigger>
                  <SelectContent>
                    {packageTypes?.map((pt) => (
                      <SelectItem key={pt.id} value={pt.id}>
                        {pt.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  min={0}
                  value={newItem.planned_quantity ?? ""}
                  onChange={(e) =>
                    setNewItem({
                      ...newItem,
                      planned_quantity: e.target.value
                        ? parseInt(e.target.value)
                        : null,
                    })
                  }
                  className="h-8 w-full"
                  placeholder="Planned"
                />
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  min={0}
                  value={newItem.actual_quantity ?? ""}
                  onChange={(e) =>
                    setNewItem({
                      ...newItem,
                      actual_quantity: e.target.value
                        ? parseInt(e.target.value)
                        : null,
                    })
                  }
                  className="h-8 w-full"
                  placeholder="Actual"
                />
              </TableCell>
              <TableCell>
                <Button
                  size="icon"
                  className="h-8 w-8"
                  onClick={handleAdd}
                  disabled={addItem.isPending}
                >
                  {addItem.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                </Button>
              </TableCell>
            </TableRow>
          )}

          {/* Empty state */}
          {(!items || items.length === 0) && !showAddRow && (
            <TableRow>
              <TableCell
                colSpan={5}
                className="text-center text-muted-foreground py-8"
              >
                No line items yet. Click &quot;Add Line Item&quot; to add products
                to this packaging session.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
        {items && items.length > 0 && (
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2} className="text-right font-medium">
                Totals
              </TableCell>
              <TableCell className="font-bold">{totalPlanned}</TableCell>
              <TableCell className="font-bold">{totalActual}</TableCell>
              {!readOnly && <TableCell />}
            </TableRow>
          </TableFooter>
        )}
      </Table>

      {showAddRow && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => setShowAddRow(false)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
