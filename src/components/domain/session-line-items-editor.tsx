"use client";

/**
 * Session Line Items Editor
 *
 * Inline editor for packaging session line items. Each line item represents
 * a product (brand + format) being packaged with planned/actual quantities.
 *
 * Uses unified selling_format_id (containers + selling_formats model).
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/universal/status-badge";
import { batchEntity } from "@/entities/batch";
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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Combobox,
  ComboboxAnchor,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxTrigger,
} from "@/components/ui/combobox";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { sessionLineItemKeys, packagingKeys } from "@/lib/query-keys";
import { useBrands, usePackagingFormats, useKegOwners } from "@/hooks/use-catalog";
import { UnitDisplay } from "@/components/ui/unit-input";

// =============================================================================
// Types
// =============================================================================

type SessionLineItemRow = {
  id: string;
  brand_id: string;
  brand_name: string;
  selling_format_id: string | null;
  selling_format_name: string | null;
  keg_owner_id: string | null;
  keg_owner_name: string | null;
  planned_quantity: number | null;
  actual_quantity: number | null;
  source_batches: Array<{
    batch_id: string;
    planned_qty: number | null;
    actual_qty: number | null;
  }>;
}

type SessionLineItemsEditorProps = {
  sessionId: string;
  readOnly?: boolean;
}

type NewItemState = {
  brand_id: string;
  format_id: string;
  keg_owner_id: string;
  planned_quantity: number | null;
  actual_quantity: number | null;
  batch_id: string;
}

const EMPTY_NEW_ITEM: NewItemState = {
  brand_id: "",
  format_id: "",
  keg_owner_id: "",
  planned_quantity: null,
  actual_quantity: null,
  batch_id: "",
};

// =============================================================================
// Batch Selection
// =============================================================================

type BatchOption = {
  id: string;
  batch_code: string;
  name: string;
  status: string;
  volume_bbl: number | null;
  current_vessel_name: string | null;
}

/**
 * Domain constants: packaging-context batch sort priority.
 * Batches closest to packaging readiness sort first. This is a domain-specific
 * ordering for the packaging UI, not a status label/color map (DEC-007 N/A).
 */
const STATUS_SORT_ORDER: Record<string, number> = {
  conditioning: 1,
  packaging: 2,
  fermenting: 3,
  planned: 4,
};


function useBatchesForBrand(brandId: string | null) {
  const supabase = createClient();
  return useQuery({
    queryKey: packagingKeys.batchesForBrand(brandId ?? ""),
    queryFn: async () => {
      if (!brandId) return [];
      // Get active batches from the view
      const { data, error } = await supabase
        .from("batches_with_brew_info")
        .select(
          "id, batch_code, name, status, volume_bbl, current_vessel_name, recipe_id"
        )
        .in("status", ["planned", "fermenting", "conditioning", "packaging"]);
      if (error) throw error;

      // Filter by brand through recipes
      const recipeIds = [
        ...new Set(
          (data ?? [])
            .map((b) => b.recipe_id)
            .filter((id): id is string => id != null)
        ),
      ];
      if (recipeIds.length === 0) return [];

      const { data: recipes, error: recipeError } = await supabase
        .from("recipes")
        .select("id, brand_id")
        .in("id", recipeIds)
        .eq("brand_id", brandId);
      if (recipeError) throw recipeError;

      const validRecipeIds = new Set((recipes ?? []).map((r) => r.id));
      return (data ?? [])
        .filter((b) => b.recipe_id && validRecipeIds.has(b.recipe_id))
        .sort(
          (a, b) =>
            (STATUS_SORT_ORDER[a.status ?? ""] ?? 99) -
            (STATUS_SORT_ORDER[b.status ?? ""] ?? 99)
        ) as BatchOption[];
    },
    enabled: !!brandId,
  });
}

function BatchCell({
  brandId,
  currentBatchId,
  onSelect,
  readOnly,
}: {
  brandId: string;
  currentBatchId: string;
  onSelect: (batchId: string) => void;
  readOnly: boolean;
}) {
  const { data: batches, isLoading } = useBatchesForBrand(brandId || null);

  if (readOnly) {
    const batch = batches?.find((b) => b.id === currentBatchId);
    return <span>{batch?.batch_code ?? "—"}</span>;
  }

  return (
    <Select value={currentBatchId} onValueChange={onSelect}>
      <SelectTrigger className="h-8">
        <SelectValue placeholder="Select batch" />
      </SelectTrigger>
      <SelectContent>
        {isLoading && (
          <SelectItem value="_loading" disabled>
            Loading...
          </SelectItem>
        )}
        {batches?.map((batch) => (
          <SelectItem key={batch.id} value={batch.id}>
            <span className="flex items-center gap-2">
              {batch.batch_code}
              <StatusBadge
                status={batch.status}
                config={batchEntity.stateMachine?.stateDisplay}
              />
              {batch.volume_bbl != null && (
                <span className="text-xs text-muted-foreground">
                  <UnitDisplay value={batch.volume_bbl} unitType="volume" />
                </span>
              )}
            </span>
          </SelectItem>
        ))}
        {!isLoading && (!batches || batches.length === 0) && (
          <SelectItem value="_none" disabled>
            No batches available
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  );
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
  const [newItem, setNewItem] = useState<NewItemState>({ ...EMPTY_NEW_ITEM });
  const [showAddRow, setShowAddRow] = useState(false);

  // Fetch session line items with resolved names
  const { data: items, isLoading: itemsLoading } = useQuery({
    queryKey: sessionLineItemKeys.all(sessionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("session_line_items")
        .select("*, brands(name), selling_formats(name), keg_owners(name)")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true });
      if (error) throw error;

      return data.map((item) => ({
        id: item.id,
        brand_id: item.brand_id,
        brand_name: (item.brands as { name: string } | null)?.name || "Unknown",
        selling_format_id: item.selling_format_id,
        selling_format_name:
          (item.selling_formats as { name: string } | null)?.name || null,
        keg_owner_id: item.keg_owner_id,
        keg_owner_name:
          (item.keg_owners as { name: string } | null)?.name || null,
        planned_quantity: item.planned_quantity,
        actual_quantity: item.actual_quantity,
        source_batches:
          (item.source_batches as Array<{
            batch_id: string;
            planned_qty: number | null;
            actual_qty: number | null;
          }>) ?? [],
      })) as SessionLineItemRow[];
    },
  });

  // Fetch catalog data
  const { data: brands } = useBrands();
  const { data: packagingFormats } = usePackagingFormats();
  const { data: kegOwners } = useKegOwners();

  // O(1) keg format lookup — avoids O(n) isKegFormat() calls in render
  const kegFormatIds = useMemo(
    () => new Set(packagingFormats?.filter((f) => f.container_type === "keg").map((f) => f.id)),
    [packagingFormats]
  );

  // Batch options for new item row
  const { data: newItemBatches, isLoading: newItemBatchesLoading } =
    useBatchesForBrand(newItem.brand_id || null);

  // Add item mutation
  const addItem = useMutation({
    mutationFn: async (item: NewItemState) => {
      const isKeg = kegFormatIds.has(item.format_id);
      const sourceBatches = item.batch_id
        ? [
            {
              batch_id: item.batch_id,
              planned_qty: item.planned_quantity,
              actual_qty: item.actual_quantity,
            },
          ]
        : [];
      const { error } = await supabase.from("session_line_items").insert({
        session_id: sessionId,
        brand_id: item.brand_id,
        selling_format_id: item.format_id || null,
        keg_owner_id: isKeg ? item.keg_owner_id || null : null,
        planned_quantity: item.planned_quantity,
        actual_quantity: item.actual_quantity,
        source_batches: sourceBatches,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: sessionLineItemKeys.all(sessionId),
      });
      setNewItem({ ...EMPTY_NEW_ITEM });
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
      queryClient.invalidateQueries({
        queryKey: sessionLineItemKeys.all(sessionId),
      });
    },
    onError: () => {
      toast.error("Failed to update line item");
    },
  });

  // Handle format change for existing items
  const handleFormatChange = async (itemId: string, formatId: string) => {
    const format = packagingFormats?.find((f) => f.id === formatId);
    if (!format) return;

    const updates: Record<string, unknown> = { selling_format_id: formatId };
    if (format.container_type !== "keg") {
      updates.keg_owner_id = null;
    }

    const { error } = await supabase
      .from("session_line_items")
      .update(updates)
      .eq("id", itemId);
    if (error) {
      toast.error("Failed to update format");
      return;
    }
    queryClient.invalidateQueries({
      queryKey: sessionLineItemKeys.all(sessionId),
    });
  };

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
      queryClient.invalidateQueries({
        queryKey: sessionLineItemKeys.all(sessionId),
      });
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

  // Helper: get display format name
  const getFormatName = (item: SessionLineItemRow) =>
    item.selling_format_name ?? "—";

  const getFormatId = (item: SessionLineItemRow) =>
    item.selling_format_id ?? "";

  // Handle add item
  const handleAdd = () => {
    if (!newItem.brand_id) {
      toast.error("Please select a brand");
      return;
    }
    if (!newItem.format_id) {
      toast.error("Please select a format");
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
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowAddRow(true)}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Line Item
          </Button>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Brand</TableHead>
            <TableHead>Batch</TableHead>
            <TableHead>Format</TableHead>
            <TableHead className="w-[120px]">Planned Qty</TableHead>
            <TableHead className="w-[120px]">Actual Qty</TableHead>
            {!readOnly && <TableHead className="w-[60px]" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items?.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="font-medium">{item.brand_name}</TableCell>
              <TableCell>
                <BatchCell
                  brandId={item.brand_id}
                  currentBatchId={item.source_batches?.[0]?.batch_id ?? ""}
                  onSelect={(batchId) =>
                    updateItem.mutate({
                      id: item.id,
                      field: "source_batches",
                      value: [
                        {
                          batch_id: batchId,
                          planned_qty: item.planned_quantity,
                          actual_qty: item.actual_quantity,
                        },
                      ],
                    })
                  }
                  readOnly={readOnly}
                />
              </TableCell>
              <TableCell>
                {readOnly ? (
                  <span className="flex items-center gap-1.5">
                    {getFormatName(item)}
                    {item.selling_format_id && kegFormatIds.has(item.selling_format_id) && item.keg_owner_name && (
                      <Badge variant="outline" className="text-xs">{item.keg_owner_name}</Badge>
                    )}
                  </span>
                ) : (
                  <div className="space-y-1">
                    <Combobox
                      value={getFormatId(item)}
                      onValueChange={(v) => handleFormatChange(item.id, v)}
                      onFilter={(values, search) => {
                        const term = search.toLowerCase();
                        return values.filter((v) => packagingFormats?.find((f) => f.id === v)?.name.toLowerCase().includes(term));
                      }}
                    >
                      <ComboboxAnchor className="h-8">
                        <ComboboxInput className="h-8" placeholder="Select format" />
                        <ComboboxTrigger />
                      </ComboboxAnchor>
                      <ComboboxContent>
                        <ComboboxEmpty>No formats found</ComboboxEmpty>
                        {packagingFormats?.map((f) => (
                          <ComboboxItem key={f.id} value={f.id} label={f.name}>
                            <span className="flex items-center gap-2">
                              {f.name}
                              {f.container_type === "keg" && (
                                <Badge variant="outline" className="text-xs">keg</Badge>
                              )}
                            </span>
                          </ComboboxItem>
                        ))}
                      </ComboboxContent>
                    </Combobox>
                    {item.selling_format_id && kegFormatIds.has(item.selling_format_id) && (
                      <Combobox
                        value={item.keg_owner_id || ""}
                        onValueChange={(v) =>
                          updateItem.mutate({ id: item.id, field: "keg_owner_id", value: v || null })
                        }
                        onFilter={(values, search) => {
                          const term = search.toLowerCase();
                          return values.filter((v) => kegOwners?.find((o) => o.id === v)?.name.toLowerCase().includes(term));
                        }}
                      >
                        <ComboboxAnchor className="h-8">
                          <ComboboxInput className="h-8" placeholder="Keg owner (optional)" />
                          <ComboboxTrigger />
                        </ComboboxAnchor>
                        <ComboboxContent>
                          <ComboboxEmpty>No owners found</ComboboxEmpty>
                          {kegOwners?.map((o) => (
                            <ComboboxItem key={o.id} value={o.id} label={o.name}>
                              {o.name}
                            </ComboboxItem>
                          ))}
                        </ComboboxContent>
                      </Combobox>
                    )}
                  </div>
                )}
              </TableCell>
              <TableCell>
                {readOnly ? (
                  item.planned_quantity ?? "—"
                ) : (
                  <Input
                    type="number"
                    min={0}
                    key={`planned-${item.id}-${item.planned_quantity}`}
                    defaultValue={item.planned_quantity ?? ""}
                    onBlur={(e) =>
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
                    key={`actual-${item.id}-${item.actual_quantity}`}
                    defaultValue={item.actual_quantity ?? ""}
                    onBlur={(e) =>
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
                    aria-label="Remove line item"
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
                <Combobox
                  value={newItem.brand_id}
                  onValueChange={(v) =>
                    setNewItem({ ...newItem, brand_id: v, batch_id: "" })
                  }
                  onFilter={(values, search) => {
                    const term = search.toLowerCase();
                    return values.filter((v) => brands?.find((b) => b.id === v)?.name.toLowerCase().includes(term));
                  }}
                >
                  <ComboboxAnchor className="h-8">
                    <ComboboxInput className="h-8" placeholder="Select brand" />
                    <ComboboxTrigger />
                  </ComboboxAnchor>
                  <ComboboxContent>
                    <ComboboxEmpty>No brands found</ComboboxEmpty>
                    {brands?.map((brand) => (
                      <ComboboxItem key={brand.id} value={brand.id} label={brand.name}>
                        {brand.name}
                      </ComboboxItem>
                    ))}
                  </ComboboxContent>
                </Combobox>
              </TableCell>
              <TableCell>
                <Select
                  value={newItem.batch_id}
                  onValueChange={(value) =>
                    setNewItem({ ...newItem, batch_id: value })
                  }
                >
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Select batch" />
                  </SelectTrigger>
                  <SelectContent>
                    {newItemBatchesLoading && (
                      <SelectItem value="_loading" disabled>
                        Loading...
                      </SelectItem>
                    )}
                    {newItemBatches?.map((batch) => (
                      <SelectItem key={batch.id} value={batch.id}>
                        <span className="flex items-center gap-2">
                          {batch.batch_code}
                          <StatusBadge
                            status={batch.status}
                            config={batchEntity.stateMachine?.stateDisplay}
                          />
                          {batch.volume_bbl != null && (
                            <span className="text-xs text-muted-foreground">
                              <UnitDisplay value={batch.volume_bbl} unitType="volume" />
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                    {!newItemBatchesLoading &&
                      (!newItemBatches || newItemBatches.length === 0) && (
                        <SelectItem value="_none" disabled>
                          No batches available
                        </SelectItem>
                      )}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <div className="space-y-1">
                  <Combobox
                    value={newItem.format_id}
                    onValueChange={(v) => {
                      const format = packagingFormats?.find((f) => f.id === v);
                      setNewItem({
                        ...newItem,
                        format_id: v,
                        keg_owner_id: format?.container_type === "keg" ? newItem.keg_owner_id : "",
                      });
                    }}
                    onFilter={(values, search) => {
                      const term = search.toLowerCase();
                      return values.filter((v) => packagingFormats?.find((f) => f.id === v)?.name.toLowerCase().includes(term));
                    }}
                  >
                    <ComboboxAnchor className="h-8">
                      <ComboboxInput className="h-8" placeholder="Select format" />
                      <ComboboxTrigger />
                    </ComboboxAnchor>
                    <ComboboxContent>
                      <ComboboxEmpty>No formats found</ComboboxEmpty>
                      {packagingFormats?.map((f) => (
                        <ComboboxItem key={f.id} value={f.id} label={f.name}>
                          <span className="flex items-center gap-2">
                            {f.name}
                            {f.container_type === "keg" && (
                              <Badge variant="outline" className="text-xs">keg</Badge>
                            )}
                          </span>
                        </ComboboxItem>
                      ))}
                    </ComboboxContent>
                  </Combobox>
                  {kegFormatIds.has(newItem.format_id) && (
                    <Combobox
                      value={newItem.keg_owner_id}
                      onValueChange={(v) => setNewItem({ ...newItem, keg_owner_id: v })}
                      onFilter={(values, search) => {
                        const term = search.toLowerCase();
                        return values.filter((v) => kegOwners?.find((o) => o.id === v)?.name.toLowerCase().includes(term));
                      }}
                    >
                      <ComboboxAnchor className="h-8">
                        <ComboboxInput className="h-8" placeholder="Keg owner (optional)" />
                        <ComboboxTrigger />
                      </ComboboxAnchor>
                      <ComboboxContent>
                        <ComboboxEmpty>No owners found</ComboboxEmpty>
                        {kegOwners?.map((o) => (
                          <ComboboxItem key={o.id} value={o.id} label={o.name}>
                            {o.name}
                          </ComboboxItem>
                        ))}
                      </ComboboxContent>
                    </Combobox>
                  )}
                </div>
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
                  aria-label="Add line item"
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
                colSpan={6}
                className="text-center text-muted-foreground py-8"
              >
                No line items yet. Click &quot;Add Line Item&quot; to add
                products to this packaging session.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
        {items && items.length > 0 && (
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3} className="text-right font-medium">
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
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAddRow(false)}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
