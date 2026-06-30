"use client";

/**
 * SupplierCatalogSection — "Catalog Items" tab on the supplier detail page.
 *
 * Relation-tab component (supplier.relations.catalog_items) that manages the
 * polymorphic supplier_catalog table: which items this supplier provides,
 * with price, unit, MOQ, lead time, SKU and the preferred-supplier flag. A
 * custom component is required here because (catalog_type, catalog_id) is
 * polymorphic — the standard RelationTable can't resolve item names across
 * the catalog tables (malts, hops, ... , inventory_items).
 *
 * These rows feed the shortfall pipeline: preferred supplier + price + lead
 * time drive supplier assignment on the Ingredient Demand page (migrations
 * 00110/00150) and the Material Planning page (00163/00164). Without a
 * catalog row, lead time silently falls back to 7 days, so capturing rows
 * here also makes order-by dates accurate. Marking a row preferred demotes
 * any other supplier's preferred row for the same item.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { catalogKeys, materialPlanningKeys, purchasingKeys, supplierKeys } from "@/lib/query-keys";
import { parseUnknownError } from "@/lib/errors";
import { dynamicFrom } from "@/services/types";
import type { Database } from "@/types/supabase";
import {
  SUPPLIER_CATALOG_CONFLICT,
  SUPPLIER_CATALOG_TABLES,
  SUPPLIER_CATALOG_TYPES,
  demoteOtherPreferredSuppliers,
  getSupplierCatalogTypeLabel,
  resolveSupplierCatalogNames,
} from "@/domain/purchasing/supplier-catalog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// =============================================================================
// Types
// =============================================================================

type CatalogRow = Database["public"]["Tables"]["supplier_catalog"]["Row"] & {
  /** Resolved from the catalog table for catalog_type (raw id when unknown). */
  catalog_name: string;
};

/** Dialog form state — numerics held as strings until save. */
type CatalogFormState = {
  id: string | null;
  catalog_type: string;
  catalog_id: string;
  supplier_sku: string;
  price: string;
  unit: string;
  min_order_qty: string;
  lead_time_days: string;
  is_preferred: boolean;
  notes: string;
};

const EMPTY_FORM: CatalogFormState = {
  id: null,
  catalog_type: "",
  catalog_id: "",
  supplier_sku: "",
  price: "",
  unit: "",
  min_order_qty: "",
  lead_time_days: "",
  is_preferred: false,
  notes: "",
};

// =============================================================================
// Helpers
// =============================================================================

/** "" → null; otherwise Number(), null when not finite. */
function parseOptionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function formatPrice(price: number | null): string {
  if (price === null) return "—";
  return `$${price.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })}`;
}

// =============================================================================
// Component
// =============================================================================

export function SupplierCatalogSection({ parentId }: { parentId: string; data?: Record<string, unknown> }) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<CatalogFormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<CatalogRow | null>(null);

  const isEditing = form.id !== null;

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: supplierKeys.catalog(parentId),
    enabled: !!parentId,
    queryFn: async (): Promise<CatalogRow[]> => {
      const { data, error } = await supabase
        .from("supplier_catalog")
        .select("*")
        .eq("supplier_id", parentId)
        .order("catalog_type")
        .order("created_at");
      if (error) throw error;
      const names = await resolveSupplierCatalogNames(supabase, data);
      return data.map((row) => ({
        ...row,
        catalog_name: names.get(`${row.catalog_type}:${row.catalog_id}`) ?? row.catalog_id,
      }));
    },
  });

  // Item options for the Add dialog (per selected catalog type)
  const itemTable = SUPPLIER_CATALOG_TABLES[form.catalog_type];
  const { data: itemOptions = [] } = useQuery({
    queryKey: catalogKeys.items(form.catalog_type),
    enabled: dialogOpen && !isEditing && !!itemTable,
    queryFn: async () => {
      const { data, error } = await dynamicFrom(supabase, itemTable)
        .select("id, name")
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: supplierKeys.catalog(parentId) });
    // Preferred supplier / price / lead time feed both shortfall pipelines.
    queryClient.invalidateQueries({ queryKey: purchasingKeys.all() });
    queryClient.invalidateQueries({ queryKey: materialPlanningKeys.all() });
  };

  const saveMutation = useMutation({
    mutationFn: async (values: CatalogFormState) => {
      const payload = {
        supplier_id: parentId,
        catalog_type: values.catalog_type,
        catalog_id: values.catalog_id,
        supplier_sku: values.supplier_sku.trim() || null,
        price: parseOptionalNumber(values.price),
        unit: values.unit.trim() || null,
        min_order_qty: parseOptionalNumber(values.min_order_qty),
        lead_time_days: parseOptionalNumber(values.lead_time_days),
        is_preferred: values.is_preferred,
        notes: values.notes.trim() || null,
      };

      // Keep at most one preferred supplier per item (deterministic
      // DISTINCT ON in the shortfall views).
      if (values.is_preferred) {
        await demoteOtherPreferredSuppliers(supabase, {
          supplierId: parentId,
          catalogType: values.catalog_type,
          catalogId: values.catalog_id,
        });
      }

      if (values.id) {
        const { error } = await supabase
          .from("supplier_catalog")
          .update(payload)
          .eq("id", values.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("supplier_catalog")
          .upsert(payload, { onConflict: SUPPLIER_CATALOG_CONFLICT });
        if (error) throw error;
      }
    },
    onSuccess: (_, values) => {
      toast.success(values.id ? "Catalog item updated" : "Catalog item added");
      setDialogOpen(false);
      invalidate();
    },
    onError: (err) => toast.error(parseUnknownError(err).message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("supplier_catalog").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Catalog item removed");
      setDeleteTarget(null);
      invalidate();
    },
    onError: (err) => toast.error(parseUnknownError(err).message),
  });

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const openAdd = () => {
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (row: CatalogRow) => {
    setForm({
      id: row.id,
      catalog_type: row.catalog_type,
      catalog_id: row.catalog_id,
      supplier_sku: row.supplier_sku ?? "",
      price: row.price !== null ? String(row.price) : "",
      unit: row.unit ?? "",
      min_order_qty: row.min_order_qty !== null ? String(row.min_order_qty) : "",
      lead_time_days: row.lead_time_days !== null ? String(row.lead_time_days) : "",
      is_preferred: row.is_preferred ?? false,
      notes: row.notes ?? "",
    });
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!form.catalog_type) {
      toast.error("Select an item type");
      return;
    }
    if (!form.catalog_id) {
      toast.error("Select an item");
      return;
    }
    saveMutation.mutate(form);
  };

  const editingName = isEditing
    ? rows.find((r) => r.id === form.id)?.catalog_name
    : undefined;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Catalog Items</CardTitle>
          <CardDescription>
            Items this supplier provides. Preferred items, prices, and lead
            times drive supplier assignment on the Ingredient Demand and
            Material Planning pages.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={openAdd}>
          <Plus className="h-4 w-4 mr-1" />
          Add Item
        </Button>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-center text-destructive py-8">Failed to load catalog items</p>
        ) : isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">
            No catalog items yet — add the items this supplier provides to
            stop re-assigning suppliers on every demand-planning visit.
          </p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">MOQ</TableHead>
                  <TableHead className="text-right">Lead Time</TableHead>
                  <TableHead>Preferred</TableHead>
                  <TableHead className="w-[88px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.catalog_name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {getSupplierCatalogTypeLabel(row.catalog_type)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.supplier_sku || "—"}
                    </TableCell>
                    <TableCell className="text-right">{formatPrice(row.price)}</TableCell>
                    <TableCell className="text-muted-foreground">{row.unit || "—"}</TableCell>
                    <TableCell className="text-right">
                      {row.min_order_qty !== null
                        ? row.min_order_qty.toLocaleString(undefined, { maximumFractionDigits: 2 })
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.lead_time_days !== null ? `${row.lead_time_days} days` : "—"}
                    </TableCell>
                    <TableCell>
                      {row.is_preferred ? (
                        <Badge className="gap-1">
                          <Star className="h-3 w-3" />
                          Preferred
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${row.catalog_name}`}
                          onClick={() => openEdit(row)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${row.catalog_name}`}
                          onClick={() => setDeleteTarget(row)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>
              {isEditing ? `Edit ${editingName ?? "Catalog Item"}` : "Add Catalog Item"}
            </DialogTitle>
            <DialogDescription>
              {isEditing
                ? "Update pricing, lead time, and ordering terms for this item."
                : "Record an item this supplier provides, with pricing and lead time."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            {!isEditing && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="catalog-type">Item Type</Label>
                  <Select
                    value={form.catalog_type}
                    onValueChange={(value) =>
                      setForm((f) => ({ ...f, catalog_type: value, catalog_id: "" }))
                    }
                  >
                    <SelectTrigger id="catalog-type">
                      <SelectValue placeholder="Select type..." />
                    </SelectTrigger>
                    <SelectContent>
                      {SUPPLIER_CATALOG_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="catalog-item">Item</Label>
                  <Select
                    value={form.catalog_id}
                    onValueChange={(value) => setForm((f) => ({ ...f, catalog_id: value }))}
                    disabled={!form.catalog_type}
                  >
                    <SelectTrigger id="catalog-item">
                      <SelectValue placeholder="Select item..." />
                    </SelectTrigger>
                    <SelectContent>
                      {itemOptions.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="catalog-sku">Supplier SKU</Label>
                <Input
                  id="catalog-sku"
                  value={form.supplier_sku}
                  onChange={(e) => setForm((f) => ({ ...f, supplier_sku: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="catalog-unit">Unit</Label>
                <Input
                  id="catalog-unit"
                  value={form.unit}
                  onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                  placeholder="e.g., lb"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="catalog-price">Price</Label>
                <Input
                  id="catalog-price"
                  inputMode="decimal"
                  value={form.price}
                  onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="catalog-moq">Min Order Qty</Label>
                <Input
                  id="catalog-moq"
                  inputMode="decimal"
                  value={form.min_order_qty}
                  onChange={(e) => setForm((f) => ({ ...f, min_order_qty: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="catalog-lead">Lead Time (days)</Label>
                <Input
                  id="catalog-lead"
                  inputMode="numeric"
                  value={form.lead_time_days}
                  onChange={(e) => setForm((f) => ({ ...f, lead_time_days: e.target.value }))}
                  placeholder="e.g., 7"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="catalog-notes">Notes</Label>
              <Input
                id="catalog-notes"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Optional"
              />
            </div>

            <div className="flex items-start gap-2">
              <Checkbox
                id="catalog-preferred"
                checked={form.is_preferred}
                onCheckedChange={(checked) =>
                  setForm((f) => ({ ...f, is_preferred: checked === true }))
                }
              />
              <div className="grid gap-0.5 leading-none">
                <Label htmlFor="catalog-preferred">Preferred supplier for this item</Label>
                <p className="text-xs text-muted-foreground">
                  Used to auto-assign this supplier in demand planning. Any
                  other supplier marked preferred for this item is demoted.
                </p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving..." : isEditing ? "Save Changes" : "Add Item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove catalog item?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes {deleteTarget?.catalog_name ?? "this item"} from this
              supplier&apos;s catalog. Demand planning will no longer
              auto-assign this supplier for the item.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
