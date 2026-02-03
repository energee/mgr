"use client";

/**
 * Ingredient Demand Page
 *
 * Shows ingredient demand from planned/fermenting batches:
 * - Summary cards for demand overview
 * - Filter controls for horizon and ingredient type
 * - Shortfalls grouped by supplier with editable quantities
 * - Per-supplier and bulk PO generation
 */

import { useState, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { purchasingKeys } from "@/lib/query-keys";
import {
  calculateIngredientShortfalls,
  calculateIngredientDemand,
  getCatalogTypeDisplay,
} from "@/lib/purchasing/demand-calculator";
import type { IngredientShortfall } from "@/lib/purchasing/demand-calculator";
import {
  groupShortfallsBySupplier,
  createDraftPO,
} from "@/lib/purchasing/po-generator";
import type { PODraft } from "@/lib/purchasing/po-generator";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Package,
  AlertTriangle,
  TrendingUp,
  DollarSign,
  RefreshCw,
  ShoppingCart,
  Loader2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { SupplierGroupCard } from "@/components/domain/supplier-group-card";
import { UnassignedShortfallsCard } from "@/components/domain/unassigned-shortfalls-card";

// =============================================================================
// Types
// =============================================================================

interface DemandFilters {
  horizonWeeks: number;
  catalogType: string; // "_all" or specific type
}

// =============================================================================
// Component
// =============================================================================

export default function IngredientDemandPage() {
  const queryClient = useQueryClient();
  const router = useRouter();

  // Filter state
  const [filters, setFilters] = useState<DemandFilters>({
    horizonWeeks: 8,
    catalogType: "_all",
  });

  // Track editable quantities: key = "catalogType-catalogId", value = quantity
  const [quantityOverrides, setQuantityOverrides] = useState<Map<string, number>>(new Map());

  // Track supplier assignments for unassigned items
  const [supplierAssignments, setSupplierAssignments] = useState<
    Map<string, { supplierId: string; supplierName: string }>
  >(new Map());

  // Loading state for PO generation
  const [generatingPO, setGeneratingPO] = useState<string | null>(null); // supplier_id or "all"

  // Fetch shortfalls
  const {
    data: shortfalls = [],
    isLoading: shortfallsLoading,
    refetch,
  } = useQuery({
    queryKey: purchasingKeys.ingredientShortfalls({ horizonWeeks: filters.horizonWeeks }),
    queryFn: async () => calculateIngredientShortfalls(filters.horizonWeeks),
    refetchInterval: 60000,
  });

  // Fetch all demand for summary
  const { data: demand = [] } = useQuery({
    queryKey: purchasingKeys.ingredientDemand({ horizonWeeks: filters.horizonWeeks }),
    queryFn: async () => calculateIngredientDemand(filters.horizonWeeks),
    refetchInterval: 60000,
  });

  // Filter shortfalls by catalog type
  const filteredShortfalls = useMemo(() => {
    return filters.catalogType === "_all"
      ? shortfalls
      : shortfalls.filter((s) => s.catalog_type === filters.catalogType);
  }, [shortfalls, filters.catalogType]);

  // Split into assigned and unassigned, applying local supplier assignments
  const { assignedShortfalls, unassignedShortfalls } = useMemo(() => {
    const assigned: IngredientShortfall[] = [];
    const unassigned: IngredientShortfall[] = [];

    for (const s of filteredShortfalls) {
      const key = `${s.catalog_type}-${s.catalog_id}`;
      const localAssignment = supplierAssignments.get(key);

      if (s.preferred_supplier_id) {
        assigned.push(s);
      } else if (localAssignment) {
        // User assigned a supplier locally — treat as assigned
        assigned.push({
          ...s,
          preferred_supplier_id: localAssignment.supplierId,
          preferred_supplier_name: localAssignment.supplierName,
        });
      } else {
        unassigned.push(s);
      }
    }

    return { assignedShortfalls: assigned, unassignedShortfalls: unassigned };
  }, [filteredShortfalls, supplierAssignments]);

  // Group assigned shortfalls by supplier
  const supplierGroups = useMemo(() => {
    const groups = groupShortfallsBySupplier(assignedShortfalls);

    // Apply quantity overrides
    for (const group of groups) {
      for (const item of group.line_items) {
        const key = `${item.catalog_type}-${item.catalog_id}`;
        const override = quantityOverrides.get(key);
        if (override !== undefined) {
          item.quantity = override;
          item.estimated_total = item.unit_price ? override * item.unit_price : null;
        }
      }
      // Recalculate group total
      group.estimated_total = group.line_items.reduce(
        (sum, item) => sum + (item.estimated_total || 0),
        0
      );
    }

    // Sort: groups with urgent items first, then by earliest order_by_date
    return groups.sort((a, b) => {
      const aHasUrgent = a.line_items.some((i) => i.is_urgent);
      const bHasUrgent = b.line_items.some((i) => i.is_urgent);
      if (aHasUrgent && !bHasUrgent) return -1;
      if (!aHasUrgent && bHasUrgent) return 1;
      return a.order_by_date.localeCompare(b.order_by_date);
    });
  }, [assignedShortfalls, quantityOverrides]);

  // Summary stats
  const totalDemandItems = demand.length;
  const shortfallCount = shortfalls.length;
  const urgentCount = shortfalls.filter((s) => s.is_urgent).length;
  const suppliersAffected = supplierGroups.length;
  const estimatedTotalCost = supplierGroups.reduce(
    (sum, g) => sum + g.estimated_total,
    0
  );

  // Get unique catalog types for filter
  const catalogTypes = Array.from(new Set(shortfalls.map((s) => s.catalog_type))).sort();

  // Handlers
  const handleQuantityChange = useCallback(
    (catalogType: string, catalogId: string, qty: number) => {
      setQuantityOverrides((prev) => {
        const next = new Map(prev);
        next.set(`${catalogType}-${catalogId}`, qty);
        return next;
      });
    },
    []
  );

  const handleAssignSupplier = useCallback(
    (catalogType: string, catalogId: string, supplierId: string, supplierName: string) => {
      setSupplierAssignments((prev) => {
        const next = new Map(prev);
        next.set(`${catalogType}-${catalogId}`, { supplierId, supplierName });
        return next;
      });
    },
    []
  );

  const handleGeneratePO = useCallback(
    async (draft: PODraft) => {
      setGeneratingPO(draft.supplier_id);
      try {
        const poId = await createDraftPO(draft);
        toast.success(
          `PO created for ${draft.supplier_name} (${draft.item_count} items)`,
          {
            action: {
              label: "View PO",
              onClick: () => router.push(`/purchasing/purchase-orders/${poId}`),
            },
          }
        );
        queryClient.invalidateQueries({ queryKey: purchasingKeys.all() });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to create PO";
        toast.error(message);
      } finally {
        setGeneratingPO(null);
      }
    },
    [queryClient, router]
  );

  const handleGenerateAllPOs = useCallback(async () => {
    setGeneratingPO("all");
    let created = 0;
    let failed = 0;

    for (const group of supplierGroups) {
      try {
        await createDraftPO(group);
        created++;
      } catch {
        failed++;
      }
    }

    if (created > 0) {
      toast.success(`Created ${created} draft PO${created !== 1 ? "s" : ""}${failed > 0 ? ` (${failed} failed)` : ""}`);
      queryClient.invalidateQueries({ queryKey: purchasingKeys.all() });
    } else if (failed > 0) {
      toast.error(`Failed to create ${failed} PO${failed !== 1 ? "s" : ""}`);
    }

    setGeneratingPO(null);
  }, [supplierGroups, queryClient]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Ingredient Demand</h1>
        <div className="flex items-center gap-2">
          {supplierGroups.length > 0 && (
            <Button
              onClick={handleGenerateAllPOs}
              disabled={!!generatingPO || unassignedShortfalls.length > 0}
              title={
                unassignedShortfalls.length > 0
                  ? "Assign all items to a supplier first"
                  : undefined
              }
            >
              {generatingPO === "all" ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <ShoppingCart className="h-4 w-4 mr-2" />
                  Generate All POs ({supplierGroups.length})
                </>
              )}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => refetch()}
            disabled={shortfallsLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${shortfallsLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2">
              <Label htmlFor="horizon">Planning Horizon</Label>
              <Select
                value={filters.horizonWeeks.toString()}
                onValueChange={(value) =>
                  setFilters({ ...filters, horizonWeeks: parseInt(value) })
                }
              >
                <SelectTrigger id="horizon" className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="4">4 weeks</SelectItem>
                  <SelectItem value="8">8 weeks</SelectItem>
                  <SelectItem value="12">12 weeks</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="type">Ingredient Type</Label>
              <Select
                value={filters.catalogType}
                onValueChange={(value) =>
                  setFilters({ ...filters, catalogType: value })
                }
              >
                <SelectTrigger id="type" className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All Types</SelectItem>
                  {catalogTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {getCatalogTypeDisplay(type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Demand</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalDemandItems}</div>
            <p className="text-xs text-muted-foreground">ingredients needed</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Shortfalls</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{shortfallCount}</div>
            <p className="text-xs text-muted-foreground">need ordering</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Suppliers Affected</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{suppliersAffected}</div>
            <p className="text-xs text-muted-foreground">
              {unassignedShortfalls.length > 0
                ? `+ ${unassignedShortfalls.length} unassigned`
                : "all items assigned"}
            </p>
          </CardContent>
        </Card>

        <Card className={urgentCount > 0 ? "border-destructive" : ""}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {urgentCount > 0 ? "Urgent" : "Estimated Cost"}
            </CardTitle>
            {urgentCount > 0 ? (
              <AlertTriangle className="h-4 w-4 text-destructive" />
            ) : (
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            )}
          </CardHeader>
          <CardContent>
            {urgentCount > 0 ? (
              <>
                <div className="text-2xl font-bold text-destructive">{urgentCount}</div>
                <p className="text-xs text-muted-foreground">need immediate action</p>
              </>
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {estimatedTotalCost > 0 ? `$${estimatedTotalCost.toFixed(2)}` : "-"}
                </div>
                <p className="text-xs text-muted-foreground">across all POs</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Supplier Groups */}
      {shortfallsLoading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filteredShortfalls.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">No shortfalls detected</p>
              <p className="text-sm">
                All ingredient demand is covered by available inventory
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {supplierGroups.map((group) => (
            <SupplierGroupCard
              key={group.supplier_id}
              draft={group}
              hasUrgentItems={group.line_items.some((i) => i.is_urgent)}
              onQuantityChange={handleQuantityChange}
              onGeneratePO={handleGeneratePO}
              isGenerating={generatingPO === group.supplier_id}
            />
          ))}

          <UnassignedShortfallsCard
            shortfalls={unassignedShortfalls}
            onAssignSupplier={handleAssignSupplier}
          />
        </div>
      )}
    </div>
  );
}
