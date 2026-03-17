"use client";

/**
 * PackagingDayView — full-width live data-entry view for in-progress packaging sessions.
 *
 * Replaces EntityDetailUnified when a session has status "in_progress".
 * Optimized for real-time entry: always-visible quick-add row, highlighted
 * Actual Qty column (bg-amber-50), live variance calculation, and a
 * "Complete Session" button that opens the PackagingCompletionReview modal.
 */

import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/universal/status-badge";
import { batchEntity } from "@/entities/batch";
import { packagingSessionEntity } from "@/entities/packaging-session";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Loader2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { sessionLineItemKeys, entityKeys } from "@/lib/query-keys";
import { useBrands, usePackagingFormats, useKegOwners } from "@/hooks/use-catalog";
import { useBatchesForBrand, useKegFormatIds } from "@/hooks/use-packaging";
import { createNameFilter } from "@/lib/combobox-filter";
import { UnitDisplay } from "@/components/ui/unit-input";
import { PackagingCompletionReview } from "./packaging-completion-review";

// =============================================================================
// Types
// =============================================================================

type PackagingDayViewProps = {
  sessionId: string;
};

type DayViewLineItem = {
  id: string;
  brand_id: string;
  brand_name: string;
  batch_id: string | null;
  batch_number: string | null;
  selling_format_id: string | null;
  selling_format_name: string | null;
  keg_owner_id: string | null;
  keg_owner_name: string | null;
  planned_quantity: number | null;
  actual_quantity: number | null;
};

type NewItemState = {
  brand_id: string;
  format_id: string;
  keg_owner_id: string;
  planned_quantity: number | null;
  actual_quantity: number | null;
  batch_id: string;
};

const EMPTY_NEW_ITEM: NewItemState = {
  brand_id: "",
  format_id: "",
  keg_owner_id: "",
  planned_quantity: null,
  actual_quantity: null,
  batch_id: "",
};

// =============================================================================
// Batch Cell (inline select for existing rows)
// =============================================================================

function BatchCell({
  brandId,
  currentBatchId,
  onSelect,
}: {
  brandId: string;
  currentBatchId: string;
  onSelect: (batchId: string) => void;
}) {
  const { data: batches, isLoading } = useBatchesForBrand(brandId || null);

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
              {batch.batch_number}
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

export function PackagingDayView({ sessionId }: PackagingDayViewProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [newItem, setNewItem] = useState<NewItemState>({ ...EMPTY_NEW_ITEM });
  const [showReview, setShowReview] = useState(false);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  /** Session metadata */
  const { data: session, isLoading: sessionLoading } = useQuery({
    queryKey: entityKeys.detail("packaging_sessions", sessionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("packaging_sessions")
        .select("id, session_date, status, notes")
        .eq("id", sessionId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  /** Line items with resolved FK names */
  const { data: items, isLoading: itemsLoading } = useQuery({
    queryKey: sessionLineItemKeys.all(sessionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("session_line_items")
        .select(
          "*, brands(name), selling_formats(name), keg_owners(name), batches(batch_number)"
        )
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true });
      if (error) throw error;

      return data.map((item) => {
        // Supabase FK joins may return object or array depending on cardinality
        const batchRaw = item.batches as unknown;
        const batchObj = Array.isArray(batchRaw) ? batchRaw[0] : batchRaw;
        return {
          id: item.id,
          brand_id: item.brand_id,
          brand_name:
            (item.brands as { name: string } | null)?.name || "Unknown",
          batch_id: (item as Record<string, unknown>).batch_id as string | null,
          batch_number:
            (batchObj as { batch_number: string } | null)?.batch_number || null,
          selling_format_id: item.selling_format_id,
          selling_format_name:
            (item.selling_formats as { name: string } | null)?.name || null,
          keg_owner_id: item.keg_owner_id,
          keg_owner_name:
            (item.keg_owners as { name: string } | null)?.name || null,
          planned_quantity: item.planned_quantity,
          actual_quantity: item.actual_quantity,
        };
      }) as DayViewLineItem[];
    },
  });

  // Catalog data
  const { data: brands } = useBrands();
  const { data: packagingFormats } = usePackagingFormats();
  const { data: kegOwners } = useKegOwners();

  // O(1) keg format lookup
  const kegFormatIds = useKegFormatIds();

  // Batch options for the quick-add row
  const { data: newItemBatches, isLoading: newItemBatchesLoading } =
    useBatchesForBrand(newItem.brand_id || null);

  // ---------------------------------------------------------------------------
  // Totals (memoised)
  // ---------------------------------------------------------------------------

  const { totalPlanned, totalActual } = useMemo(() => {
    const planned =
      items?.reduce((sum, i) => sum + (i.planned_quantity || 0), 0) ?? 0;
    const actual =
      items?.reduce((sum, i) => sum + (i.actual_quantity || 0), 0) ?? 0;
    return { totalPlanned: planned, totalActual: actual };
  }, [items]);

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

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

  const addItem = useMutation({
    mutationFn: async (item: NewItemState) => {
      const isKeg = kegFormatIds.has(item.format_id);
      const { error } = await supabase.from("session_line_items").insert({
        session_id: sessionId,
        brand_id: item.brand_id,
        selling_format_id: item.format_id || null,
        keg_owner_id: isKeg ? item.keg_owner_id || null : null,
        batch_id: item.batch_id || null,
        planned_quantity: item.planned_quantity,
        actual_quantity: item.actual_quantity,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: sessionLineItemKeys.all(sessionId),
      });
      setNewItem({ ...EMPTY_NEW_ITEM });
      toast.success("Line item added");
    },
    onError: () => {
      toast.error("Failed to add line item");
    },
  });

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

  // Handle format change for existing items (clears keg_owner when non-keg)
  const handleFormatChange = useCallback(
    async (itemId: string, formatId: string) => {
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
    },
    [packagingFormats, supabase, queryClient, sessionId]
  );

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

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

  /** Called after successful session completion */
  const handleCompleted = useCallback(() => {
    setShowReview(false);
    queryClient.invalidateQueries({
      queryKey: entityKeys.detail("packaging_sessions", sessionId),
    });
    queryClient.invalidateQueries({
      queryKey: sessionLineItemKeys.all(sessionId),
    });
    // Navigate to reload the page — EntityDetailUnified will render for completed status
    router.push(`/production/packaging/${sessionId}`);
  }, [queryClient, sessionId, router]);

  // ---------------------------------------------------------------------------
  // Variance helper
  // ---------------------------------------------------------------------------

  const renderVariance = (planned: number | null, actual: number | null) => {
    if (actual == null) {
      return <span className="text-muted-foreground">&mdash;</span>;
    }
    const variance = actual - (planned ?? 0);
    const color =
      variance >= 0 ? "text-green-600" : "text-red-600";
    return <span className={color}>{variance > 0 ? `+${variance}` : variance}</span>;
  };

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------

  if (sessionLoading || itemsLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="text-center text-muted-foreground py-16">
        Session not found.
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* ── Header bar ────────────────────────────────────────────────────── */}
      <div className="flex justify-between items-center border-b pb-4">
        <Link
          href="/production/packaging"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to List
        </Link>

        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">
            Session: {session.session_date}
          </span>
          <StatusBadge
            status={session.status}
            config={packagingSessionEntity.stateMachine?.stateDisplay}
          />
          <div className="flex items-center gap-3 text-sm">
            <span>
              Items: <strong>{items?.length ?? 0}</strong>
            </span>
            <span>
              Planned: <strong>{totalPlanned}</strong>
            </span>
            <span>
              Actual: <strong>{totalActual}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* ── Line items table ──────────────────────────────────────────────── */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Brand</TableHead>
            <TableHead>Batch</TableHead>
            <TableHead>Format</TableHead>
            <TableHead className="w-[120px]">Planned Qty</TableHead>
            <TableHead className="w-[120px] bg-amber-50">Actual Qty</TableHead>
            <TableHead className="w-[80px]">Variance</TableHead>
            <TableHead className="w-[60px]" />
          </TableRow>
        </TableHeader>

        <TableBody>
          {items?.map((item) => (
            <TableRow key={item.id}>
              {/* Brand */}
              <TableCell className="font-medium">{item.brand_name}</TableCell>

              {/* Batch */}
              <TableCell>
                <BatchCell
                  brandId={item.brand_id}
                  currentBatchId={item.batch_id ?? ""}
                  onSelect={(batchId) =>
                    updateItem.mutate({
                      id: item.id,
                      field: "batch_id",
                      value: batchId,
                    })
                  }
                />
              </TableCell>

              {/* Format + keg owner */}
              <TableCell>
                <div className="space-y-1">
                  <Combobox
                    value={item.selling_format_id ?? ""}
                    onValueChange={(v) => handleFormatChange(item.id, v)}
                    onFilter={createNameFilter(packagingFormats)}
                  >
                    <ComboboxAnchor className="h-8">
                      <ComboboxInput
                        className="h-8"
                        placeholder="Select format"
                      />
                      <ComboboxTrigger />
                    </ComboboxAnchor>
                    <ComboboxContent>
                      <ComboboxEmpty>No formats found</ComboboxEmpty>
                      {packagingFormats?.map((f) => (
                        <ComboboxItem key={f.id} value={f.id} label={f.name}>
                          <span className="flex items-center gap-2">
                            {f.name}
                            {f.container_type === "keg" && (
                              <Badge variant="outline" className="text-xs">
                                keg
                              </Badge>
                            )}
                          </span>
                        </ComboboxItem>
                      ))}
                    </ComboboxContent>
                  </Combobox>
                  {item.selling_format_id &&
                    kegFormatIds.has(item.selling_format_id) && (
                      <Combobox
                        value={item.keg_owner_id || ""}
                        onValueChange={(v) =>
                          updateItem.mutate({
                            id: item.id,
                            field: "keg_owner_id",
                            value: v || null,
                          })
                        }
                        onFilter={createNameFilter(kegOwners)}
                      >
                        <ComboboxAnchor className="h-8">
                          <ComboboxInput
                            className="h-8"
                            placeholder="Keg owner (optional)"
                          />
                          <ComboboxTrigger />
                        </ComboboxAnchor>
                        <ComboboxContent>
                          <ComboboxEmpty>No owners found</ComboboxEmpty>
                          {kegOwners?.map((o) => (
                            <ComboboxItem
                              key={o.id}
                              value={o.id}
                              label={o.name}
                            >
                              {o.name}
                            </ComboboxItem>
                          ))}
                        </ComboboxContent>
                      </Combobox>
                    )}
                </div>
              </TableCell>

              {/* Planned Qty */}
              <TableCell>
                <Input
                  type="number"
                  min={0}
                  key={`planned-${item.id}-${item.planned_quantity}`}
                  defaultValue={item.planned_quantity ?? ""}
                  onBlur={(e) =>
                    updateItem.mutate({
                      id: item.id,
                      field: "planned_quantity",
                      value: e.target.value
                        ? parseInt(e.target.value)
                        : null,
                    })
                  }
                  className="h-8 w-full"
                  placeholder="--"
                />
              </TableCell>

              {/* Actual Qty (highlighted) */}
              <TableCell className="bg-amber-50">
                <Input
                  type="number"
                  min={0}
                  key={`actual-${item.id}-${item.actual_quantity}`}
                  defaultValue={item.actual_quantity ?? ""}
                  onBlur={(e) =>
                    updateItem.mutate({
                      id: item.id,
                      field: "actual_quantity",
                      value: e.target.value
                        ? parseInt(e.target.value)
                        : null,
                    })
                  }
                  className="h-8 w-full"
                  placeholder="--"
                />
              </TableCell>

              {/* Variance */}
              <TableCell className="text-center">
                {renderVariance(item.planned_quantity, item.actual_quantity)}
              </TableCell>

              {/* Delete */}
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
            </TableRow>
          ))}

          {/* ── Quick-add row (always visible) ──────────────────────────── */}
          <TableRow>
            {/* Brand */}
            <TableCell>
              <Combobox
                value={newItem.brand_id}
                onValueChange={(v) =>
                  setNewItem({ ...newItem, brand_id: v, batch_id: "" })
                }
                onFilter={createNameFilter(brands)}
              >
                <ComboboxAnchor className="h-8">
                  <ComboboxInput
                    className="h-8"
                    placeholder="Select brand"
                  />
                  <ComboboxTrigger />
                </ComboboxAnchor>
                <ComboboxContent>
                  <ComboboxEmpty>No brands found</ComboboxEmpty>
                  {brands?.map((brand) => (
                    <ComboboxItem
                      key={brand.id}
                      value={brand.id}
                      label={brand.name}
                    >
                      {brand.name}
                    </ComboboxItem>
                  ))}
                </ComboboxContent>
              </Combobox>
            </TableCell>

            {/* Batch */}
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
                        {batch.batch_number}
                        <StatusBadge
                          status={batch.status}
                          config={batchEntity.stateMachine?.stateDisplay}
                        />
                        {batch.volume_bbl != null && (
                          <span className="text-xs text-muted-foreground">
                            <UnitDisplay
                              value={batch.volume_bbl}
                              unitType="volume"
                            />
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

            {/* Format + keg owner */}
            <TableCell>
              <div className="space-y-1">
                <Combobox
                  value={newItem.format_id}
                  onValueChange={(v) => {
                    const format = packagingFormats?.find((f) => f.id === v);
                    setNewItem({
                      ...newItem,
                      format_id: v,
                      keg_owner_id:
                        format?.container_type === "keg"
                          ? newItem.keg_owner_id
                          : "",
                    });
                  }}
                  onFilter={createNameFilter(packagingFormats)}
                >
                  <ComboboxAnchor className="h-8">
                    <ComboboxInput
                      className="h-8"
                      placeholder="Select format"
                    />
                    <ComboboxTrigger />
                  </ComboboxAnchor>
                  <ComboboxContent>
                    <ComboboxEmpty>No formats found</ComboboxEmpty>
                    {packagingFormats?.map((f) => (
                      <ComboboxItem key={f.id} value={f.id} label={f.name}>
                        <span className="flex items-center gap-2">
                          {f.name}
                          {f.container_type === "keg" && (
                            <Badge variant="outline" className="text-xs">
                              keg
                            </Badge>
                          )}
                        </span>
                      </ComboboxItem>
                    ))}
                  </ComboboxContent>
                </Combobox>
                {kegFormatIds.has(newItem.format_id) && (
                  <Combobox
                    value={newItem.keg_owner_id}
                    onValueChange={(v) =>
                      setNewItem({ ...newItem, keg_owner_id: v })
                    }
                    onFilter={createNameFilter(kegOwners)}
                  >
                    <ComboboxAnchor className="h-8">
                      <ComboboxInput
                        className="h-8"
                        placeholder="Keg owner (optional)"
                      />
                      <ComboboxTrigger />
                    </ComboboxAnchor>
                    <ComboboxContent>
                      <ComboboxEmpty>No owners found</ComboboxEmpty>
                      {kegOwners?.map((o) => (
                        <ComboboxItem
                          key={o.id}
                          value={o.id}
                          label={o.name}
                        >
                          {o.name}
                        </ComboboxItem>
                      ))}
                    </ComboboxContent>
                  </Combobox>
                )}
              </div>
            </TableCell>

            {/* Planned */}
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

            {/* Actual */}
            <TableCell className="bg-amber-50">
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

            {/* Variance (empty for add row) */}
            <TableCell />

            {/* Add button */}
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

          {/* Empty state (only when no items exist) */}
          {(!items || items.length === 0) && (
            <TableRow>
              <TableCell
                colSpan={7}
                className="text-center text-muted-foreground py-8"
              >
                No line items yet. Use the row above to add products to this
                packaging session.
              </TableCell>
            </TableRow>
          )}
        </TableBody>

        {/* ── Totals footer ───────────────────────────────────────────────── */}
        {items && items.length > 0 && (
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3} className="text-right font-medium">
                Totals
              </TableCell>
              <TableCell className="font-bold">{totalPlanned}</TableCell>
              <TableCell className="font-bold bg-amber-50">
                {totalActual}
              </TableCell>
              <TableCell />
              <TableCell />
            </TableRow>
          </TableFooter>
        )}
      </Table>

      {/* ── Action bar ────────────────────────────────────────────────────── */}
      <div className="flex justify-end pt-2">
        <Button
          onClick={() => setShowReview(true)}
          disabled={!items || items.length === 0}
        >
          Complete Session
        </Button>
      </div>

      {/* ── Completion review modal ───────────────────────────────────────── */}
      {showReview && (
        <PackagingCompletionReview
          sessionId={sessionId}
          items={(items ?? []).map((item) => ({
            id: item.id,
            brand_name: item.brand_name,
            batch_number: item.batch_number,
            format_name: item.selling_format_name,
            planned_quantity: item.planned_quantity,
            actual_quantity: item.actual_quantity,
          }))}
          open={showReview}
          onOpenChange={setShowReview}
          onCompleted={handleCompleted}
        />
      )}
    </div>
  );
}
