"use client";

/**
 * Material Planning Page
 *
 * Unified dashboard showing material shortfalls across brewing, packaging,
 * and shipping demand sources. Helps purchasing staff identify what to order
 * and when, based on planned sessions, open orders, and brewing schedules
 * within a configurable time horizon.
 *
 * Rows with a positive shortfall and a known supplier are selectable; the
 * "Create POs for selected" action aggregates the selection per inventory
 * item, groups it per supplier, and creates draft purchase orders (line items
 * use catalog_type "inventory_item") — no need to re-enter quantities on the
 * PO form or the Ingredient Demand page (which covers brewing demand only).
 */

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, ShoppingCart } from "lucide-react";
import { useMaterialShortfalls } from "@/hooks/use-material-planning";
import type { MaterialShortfall } from "@/hooks/use-material-planning";
import { createDraftPO } from "@/domain/purchasing/po-generator";
import {
  groupMaterialShortfallsBySupplier,
  isShortfallRowOrderable,
  materialShortfallRowKey,
} from "@/domain/purchasing/material-shortfall-po-draft";
import { materialPlanningKeys, purchasingKeys } from "@/lib/query-keys";
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// =============================================================================
// Types
// =============================================================================

type HorizonWeeks = 2 | 4 | 8 | 12;
type DemandSource = "all" | "brewing" | "packaging" | "shipping";

// =============================================================================
// Helpers
// =============================================================================

/** Format an ISO date string as "Apr 25" style. */
function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Status badge for a shortfall row. */
function StatusBadgeForShortfall({
  isPastDue,
  shortfall,
}: {
  isPastDue: boolean;
  shortfall: number;
}) {
  if (isPastDue) {
    return <Badge variant="destructive">PAST DUE</Badge>;
  }
  if (shortfall > 0) {
    return (
      <Badge className="bg-amber-500 hover:bg-amber-600 text-white">
        Order Now
      </Badge>
    );
  }
  return <span className="text-sm text-muted-foreground">OK</span>;
}

/** Row background class based on shortfall status. */
function rowClass(row: MaterialShortfall): string {
  if (row.is_past_due) return "bg-destructive/10";
  if (row.shortfall > 0) return "bg-amber-50 dark:bg-amber-950/20";
  return "";
}

/** Tooltip text explaining why a row's checkbox is disabled. */
function notOrderableReason(row: MaterialShortfall): string | undefined {
  if (row.shortfall <= 0) return "No shortfall to order";
  if (!row.best_supplier_id) {
    return "No supplier carries this item — add it to a supplier catalog first";
  }
  return undefined;
}

// =============================================================================
// Component
// =============================================================================

export default function MaterialPlanningPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [horizonWeeks, setHorizonWeeks] = useState<HorizonWeeks>(8);
  const [demandSource, setDemandSource] = useState<DemandSource>("all");
  const [shortfallsOnly, setShortfallsOnly] = useState(false);

  // Row selection for PO generation, keyed by materialShortfallRowKey.
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [creatingPOs, setCreatingPOs] = useState(false);

  const { data: rows = [], isLoading } = useMaterialShortfalls({
    horizonWeeks,
    demandSource: demandSource === "all" ? undefined : demandSource,
  });

  const filtered = shortfallsOnly ? rows.filter((r) => r.shortfall > 0 || r.is_past_due) : rows;
  const pastDueCount = rows.filter((r) => r.is_past_due).length;

  // Orderable rows currently visible; selection is derived from these so
  // rows hidden by a filter change (or covered after a refetch) are never
  // silently included in a generated PO.
  const orderableRows = useMemo(
    () => filtered.filter(isShortfallRowOrderable),
    [filtered]
  );
  const selectedRows = useMemo(
    () => orderableRows.filter((r) => selectedKeys.has(materialShortfallRowKey(r))),
    [orderableRows, selectedKeys]
  );
  const allSelected =
    orderableRows.length > 0 && selectedRows.length === orderableRows.length;
  const headerChecked: boolean | "indeterminate" = allSelected
    ? true
    : selectedRows.length > 0
      ? "indeterminate"
      : false;

  const toggleRow = useCallback((key: string, checked: boolean) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const toggleAll = useCallback(
    (checked: boolean) => {
      setSelectedKeys(
        checked
          ? new Set(orderableRows.map(materialShortfallRowKey))
          : new Set()
      );
    },
    [orderableRows]
  );

  /**
   * Create one draft PO per supplier from the selected rows, mirroring the
   * Ingredient Demand page's toast + "View PO" affordance.
   */
  const handleCreatePOs = useCallback(async () => {
    const drafts = groupMaterialShortfallsBySupplier(selectedRows);
    if (drafts.length === 0) {
      toast.error("Selected rows have no remaining shortfall to order");
      return;
    }

    setCreatingPOs(true);
    let created = 0;
    let failed = 0;
    let singlePOId: string | null = null;

    for (const draft of drafts) {
      try {
        singlePOId = await createDraftPO(draft);
        created++;
      } catch {
        failed++;
      }
    }

    if (created > 0) {
      if (drafts.length === 1 && singlePOId) {
        const draft = drafts[0];
        toast.success(
          `PO created for ${draft.supplier_name} (${draft.item_count} item${draft.item_count !== 1 ? "s" : ""})`,
          {
            action: {
              label: "View PO",
              onClick: () => router.push(`/purchasing/pos/${singlePOId}`),
            },
          }
        );
      } else {
        toast.success(
          `Created ${created} draft PO${created !== 1 ? "s" : ""}${failed > 0 ? ` (${failed} failed)` : ""}`
        );
      }
      // New open POs change incoming_po, so shortfalls must refresh too.
      queryClient.invalidateQueries({ queryKey: materialPlanningKeys.shortfalls() });
      queryClient.invalidateQueries({ queryKey: purchasingKeys.all() });
    } else if (failed > 0) {
      toast.error(`Failed to create ${failed} PO${failed !== 1 ? "s" : ""}`);
    }

    // Keep the selection when something failed so the user can retry.
    if (failed === 0) setSelectedKeys(new Set());
    setCreatingPOs(false);
  }, [selectedRows, queryClient, router]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Material Planning</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Unified shortfall view across brewing, packaging, and shipping demand
            sources. Select shortfall rows to generate draft purchase orders.
          </p>
        </div>
        {orderableRows.length > 0 && (
          <Button
            size="sm"
            onClick={handleCreatePOs}
            disabled={selectedRows.length === 0 || creatingPOs}
            title={
              selectedRows.length === 0
                ? "Select shortfall rows with a supplier first"
                : undefined
            }
          >
            {creatingPOs ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <ShoppingCart className="h-4 w-4 mr-2" />
                Create POs for selected
                {selectedRows.length > 0 ? ` (${selectedRows.length})` : ""}
              </>
            )}
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Horizon */}
        <div className="flex items-center gap-2">
          <Label htmlFor="horizon-select" className="text-sm whitespace-nowrap">
            Horizon
          </Label>
          <Select
            value={horizonWeeks.toString()}
            onValueChange={(v) => setHorizonWeeks(parseInt(v) as HorizonWeeks)}
          >
            <SelectTrigger id="horizon-select" className="h-8 w-[110px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="2">2 weeks</SelectItem>
              <SelectItem value="4">4 weeks</SelectItem>
              <SelectItem value="8">8 weeks</SelectItem>
              <SelectItem value="12">12 weeks</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Demand source */}
        <div className="flex items-center gap-2">
          <Label htmlFor="source-select" className="text-sm whitespace-nowrap">
            Source
          </Label>
          <Select
            value={demandSource}
            onValueChange={(v) => setDemandSource(v as DemandSource)}
          >
            <SelectTrigger id="source-select" className="h-8 w-[130px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              <SelectItem value="brewing">Brewing</SelectItem>
              <SelectItem value="packaging">Packaging</SelectItem>
              <SelectItem value="shipping">Shipping</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Shortfalls only toggle */}
        <div className="flex items-center gap-2">
          <Switch
            id="shortfalls-only"
            checked={shortfallsOnly}
            onCheckedChange={setShortfallsOnly}
          />
          <Label htmlFor="shortfalls-only" className="text-sm cursor-pointer">
            Shortfalls only
          </Label>
        </div>

        {/* Summary counts */}
        {!isLoading && (
          <span className="text-xs text-muted-foreground ml-auto">
            {filtered.length} item{filtered.length !== 1 ? "s" : ""}
            {pastDueCount > 0 && (
              <span className="text-destructive font-medium ml-2">
                {pastDueCount} past due
              </span>
            )}
          </span>
        )}
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={headerChecked}
                  onCheckedChange={(checked) => toggleAll(checked === true)}
                  disabled={orderableRows.length === 0}
                  aria-label="Select all orderable rows"
                />
              </TableHead>
              <TableHead>Material</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Needed By</TableHead>
              <TableHead className="text-right">Qty Needed</TableHead>
              <TableHead className="text-right">On Hand</TableHead>
              <TableHead className="text-right">Incoming (PO)</TableHead>
              <TableHead className="text-right">Shortfall</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead className="text-right">Lead Time</TableHead>
              <TableHead>Order By</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={12} className="text-center py-12 text-muted-foreground">
                  Loading material data...
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="text-center py-12 text-muted-foreground">
                  {shortfallsOnly
                    ? "No shortfalls detected — all material demand is covered."
                    : "No material demand found for this horizon."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row, i) => (
                <TableRow
                  key={`${row.inventory_item_id}-${row.demand_source}-${i}`}
                  className={cn(rowClass(row))}
                >
                  <TableCell>
                    <Checkbox
                      // Stale selections on rows that became non-orderable are
                      // excluded from the action, so render them unchecked too.
                      checked={
                        isShortfallRowOrderable(row) &&
                        selectedKeys.has(materialShortfallRowKey(row))
                      }
                      onCheckedChange={(checked) =>
                        toggleRow(materialShortfallRowKey(row), checked === true)
                      }
                      disabled={!isShortfallRowOrderable(row)}
                      title={notOrderableReason(row)}
                      aria-label={`Select ${row.inventory_item_name}`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    {row.inventory_item_name}
                    {row.category && (
                      <span className="block text-xs text-muted-foreground">
                        {row.category}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="capitalize">{row.demand_source ?? "—"}</TableCell>
                  <TableCell>{formatDate(row.needed_by_date)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.quantity_needed.toFixed(2)}
                    {row.unit && (
                      <span className="text-muted-foreground ml-1">{row.unit}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.on_hand.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.incoming_po > 0 ? row.incoming_po.toFixed(2) : "—"}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums font-medium",
                      row.shortfall > 0 && "text-destructive"
                    )}
                  >
                    {row.shortfall > 0 ? row.shortfall.toFixed(2) : "—"}
                  </TableCell>
                  <TableCell>{row.best_supplier_name ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    {row.lead_time_days != null ? `${row.lead_time_days}d` : "—"}
                  </TableCell>
                  <TableCell>{formatDate(row.drop_dead_date)}</TableCell>
                  <TableCell>
                    <StatusBadgeForShortfall
                      isPastDue={row.is_past_due}
                      shortfall={row.shortfall}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
