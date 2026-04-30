"use client";

/**
 * Material Planning Page
 *
 * Unified dashboard showing material shortfalls across brewing, packaging,
 * and shipping demand sources. Helps purchasing staff identify what to order
 * and when, based on planned sessions, open orders, and brewing schedules
 * within a configurable time horizon.
 */

import { useState } from "react";
import { useMaterialShortfalls } from "@/hooks/use-material-planning";
import type { MaterialShortfall } from "@/hooks/use-material-planning";
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

// =============================================================================
// Component
// =============================================================================

export default function MaterialPlanningPage() {
  const [horizonWeeks, setHorizonWeeks] = useState<HorizonWeeks>(8);
  const [demandSource, setDemandSource] = useState<DemandSource>("all");
  const [shortfallsOnly, setShortfallsOnly] = useState(false);

  const { data: rows = [], isLoading } = useMaterialShortfalls({
    horizonWeeks,
    demandSource: demandSource === "all" ? undefined : demandSource,
  });

  const filtered = shortfallsOnly ? rows.filter((r) => r.shortfall > 0 || r.is_past_due) : rows;
  const pastDueCount = rows.filter((r) => r.is_past_due).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold">Material Planning</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Unified shortfall view across brewing, packaging, and shipping demand
          sources. Use this to identify what needs to be ordered and when.
        </p>
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
                <TableCell colSpan={11} className="text-center py-12 text-muted-foreground">
                  Loading material data...
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center py-12 text-muted-foreground">
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
