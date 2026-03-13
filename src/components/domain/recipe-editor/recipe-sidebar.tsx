/**
 * RecipeSidebar - Sticky sidebar showing live recipe estimates and summary.
 *
 * Reads from RecipeEditorContext for live-computed OG, FG, ABV, IBU, SRM.
 * Shows per-ingredient bag counts (ceil(weight / bag_weight)), totals,
 * fermentation info, and notes.
 */

"use client";

import { useMemo } from "react";
import { useRecipeEditor } from "./recipe-editor-context";
import type { GrainBillItem } from "@/components/domain/grain-bill-editor";
import type { HopScheduleItem } from "@/components/domain/hop-schedule-editor";
import { StatusBadge } from "@/components/universal/status-badge";
import { recipeEntity } from "@/entities/recipe";
import { cn } from "@/lib/utils";
import { Package } from "lucide-react";

/** Map SRM to approximate CSS color for the beer color indicator */
function srmToColor(srm: number | null): string {
  if (!srm || srm <= 0) return "bg-amber-100";
  if (srm <= 2) return "bg-yellow-100";
  if (srm <= 4) return "bg-yellow-300";
  if (srm <= 6) return "bg-amber-300";
  if (srm <= 9) return "bg-amber-500";
  if (srm <= 14) return "bg-amber-700";
  if (srm <= 20) return "bg-orange-800";
  if (srm <= 30) return "bg-red-900";
  return "bg-stone-900";
}

// =============================================================================
// Bag Count Calculations
// =============================================================================

type GrainBagCalc = {
  name: string;
  weightLbs: number;
  bagWeightLbs: number | null;
  bags: number | null;
  /** Percentage of total grain bill weight */
  pct: number;
}

type HopBagCalc = {
  name: string;
  weightOz: number;
  bagWeightLbs: number | null;
  bags: number | null;
  timing: string;
}

/** Calculate bag counts for each grain. bags = ceil(weight / bag_weight). */
function calcGrainBags(items: GrainBillItem[]): {
  grains: GrainBagCalc[];
  totalLbs: number;
  totalBags: number;
} {
  const totalLbs = items.reduce((sum, g) => sum + g.weight_lbs, 0);
  const grains = items.map((g) => {
    const bagWt = g.malt?.bag_weight_lbs ?? null;
    return {
      name: g.malt?.name ?? "Unknown",
      weightLbs: g.weight_lbs,
      bagWeightLbs: bagWt,
      bags: bagWt && bagWt > 0 ? Math.ceil(g.weight_lbs / bagWt) : null,
      pct: totalLbs > 0 ? Math.round((g.weight_lbs / totalLbs) * 100) : 0,
    };
  });
  const totalBags = grains.reduce((sum, g) => sum + (g.bags ?? 0), 0);
  return { grains, totalLbs, totalBags };
}

/** Calculate bag counts for each hop addition. bags = ceil((oz / 16) / bag_weight_lbs). */
function calcHopBags(items: HopScheduleItem[]): {
  hops: HopBagCalc[];
  totalOz: number;
  totalBags: number;
} {
  const totalOz = items.reduce((sum, h) => sum + h.weight_oz, 0);
  const hops = items.map((h) => {
    const bagWt = h.hop?.bag_weight_lbs ?? null;
    const weightLbs = h.weight_oz / 16;
    return {
      name: h.hop?.name ?? "Unknown",
      weightOz: h.weight_oz,
      bagWeightLbs: bagWt,
      bags: bagWt && bagWt > 0 ? Math.ceil(weightLbs / bagWt) : null,
      timing: h.timing,
    };
  });
  const totalBags = hops.reduce((sum, h) => sum + (h.bags ?? 0), 0);
  return { hops, totalOz, totalBags };
}

// =============================================================================
// Component
// =============================================================================

export function RecipeSidebar() {
  const { recipe, estimates, grainItems, hopItems } = useRecipeEditor();

  const grainCalc = useMemo(() => calcGrainBags(grainItems), [grainItems]);
  const hopCalc = useMemo(() => calcHopBags(hopItems), [hopItems]);

  return (
    <div className="sticky top-4 space-y-4">
      {/* Status + Style header */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge
            status={recipe.status}
            config={recipeEntity.stateMachine?.stateDisplay}
          />
          {recipe.style_name && (
            <span className="text-sm text-muted-foreground">
              {recipe.style_name}
            </span>
          )}
        </div>
      </div>

      {/* Estimates */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Estimates
        </h4>

        {/* ABV hero */}
        <div className="text-center py-2">
          <div className="text-3xl font-bold tabular-nums">
            {estimates.abv !== null ? `${estimates.abv}%` : "\u2014"}
          </div>
          <div className="text-xs text-muted-foreground">ABV</div>
        </div>

        {/* OG / FG / IBU / SRM grid */}
        <div className="grid grid-cols-2 gap-3">
          <EstimateCard label="OG" value={estimates.og?.toFixed(3) ?? "\u2014"} />
          <EstimateCard label="FG" value={estimates.fg?.toFixed(3) ?? "\u2014"} />
          <EstimateCard label="IBU" value={estimates.ibu?.toString() ?? "\u2014"} />
          <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
            <div
              className={cn(
                "h-4 w-4 rounded-full border",
                srmToColor(estimates.srm)
              )}
            />
            <div>
              <div className="text-xs text-muted-foreground">SRM</div>
              <div className="text-sm font-mono font-medium">
                {estimates.srm?.toString() ?? "\u2014"}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Grain Bill Detail with Bag Counts */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Grain Bill
          </h4>
          {grainCalc.totalBags > 0 && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Package className="h-3 w-3" />
              {grainCalc.totalBags} {bagLabel(grainCalc.totalBags)}
            </span>
          )}
        </div>

        {grainCalc.grains.length === 0 ? (
          <p className="text-sm text-muted-foreground">No grains</p>
        ) : (
          <div className="space-y-1.5">
            {grainCalc.grains.map((g, i) => (
              <div key={i} className="text-sm">
                <div className="flex items-center justify-between">
                  <span className="truncate mr-2">{g.name}</span>
                  <span className="text-muted-foreground tabular-nums shrink-0">
                    {g.pct}%
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="tabular-nums">
                    {formatNum(g.weightLbs)} lbs
                  </span>
                  {g.bags !== null && g.bagWeightLbs ? (
                    <span className="tabular-nums">
                      {g.bags} x {formatNum(g.bagWeightLbs)} lb {bagLabel(g.bags)}
                    </span>
                  ) : (
                    <span className="italic">no bag size</span>
                  )}
                </div>
              </div>
            ))}
            {/* Totals row */}
            <div className="border-t pt-1.5 mt-1.5 flex justify-between text-sm font-medium">
              <span>{formatNum(grainCalc.totalLbs)} lbs total</span>
              {grainCalc.totalBags > 0 && (
                <span className="tabular-nums">
                  {grainCalc.totalBags} {bagLabel(grainCalc.totalBags)}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Hop Schedule Detail with Bag Counts */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Hops
          </h4>
          {hopCalc.totalBags > 0 && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Package className="h-3 w-3" />
              {hopCalc.totalBags} {bagLabel(hopCalc.totalBags)}
            </span>
          )}
        </div>

        {hopCalc.hops.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hops</p>
        ) : (
          <div className="space-y-1.5">
            {hopCalc.hops.map((h, i) => (
              <div key={i} className="text-sm">
                <div className="flex items-center justify-between">
                  <span className="truncate mr-2">{h.name}</span>
                  <span className="text-xs text-muted-foreground capitalize shrink-0">
                    {h.timing.replace("_", " ")}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="tabular-nums">
                    {formatNum(h.weightOz)} oz
                  </span>
                  {h.bags !== null && h.bagWeightLbs ? (
                    <span className="tabular-nums">
                      {h.bags} x {formatNum(h.bagWeightLbs)} lb {bagLabel(h.bags)}
                    </span>
                  ) : (
                    <span className="italic">no bag size</span>
                  )}
                </div>
              </div>
            ))}
            {/* Totals row */}
            <div className="border-t pt-1.5 mt-1.5 flex justify-between text-sm font-medium">
              <span>{formatNum(hopCalc.totalOz)} oz total</span>
              {hopCalc.totalBags > 0 && (
                <span className="tabular-nums">
                  {hopCalc.totalBags} {bagLabel(hopCalc.totalBags)}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Fermentation Info */}
      <div className="rounded-lg border bg-card p-4 space-y-2">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Fermentation
        </h4>
        <SummaryRow
          label="Fermentation"
          value={recipe.fermentation_days ? `${recipe.fermentation_days} days` : "\u2014"}
        />
        <SummaryRow
          label="Conditioning"
          value={recipe.conditioning_days ? `${recipe.conditioning_days} days` : "\u2014"}
        />
        <SummaryRow
          label="Attenuation"
          value={recipe.target_attenuation ? `${recipe.target_attenuation}%` : "\u2014"}
        />
      </div>

      {/* Notes (read-only preview) */}
      {(recipe.brew_day_notes || recipe.development_notes) && (
        <div className="rounded-lg border bg-card p-4 space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Notes
          </h4>
          {recipe.brew_day_notes && (
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">Brew Day</div>
              <p className="text-sm line-clamp-3">{recipe.brew_day_notes}</p>
            </div>
          )}
          {recipe.development_notes && (
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">Development</div>
              <p className="text-sm line-clamp-3">{recipe.development_notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Helper Components
// =============================================================================

function EstimateCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/50 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-mono font-medium">{value}</div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

/** Format a number: show decimals only if needed */
function formatNum(n: number): string {
  return n % 1 === 0 ? n.toString() : n.toFixed(1);
}

function bagLabel(count: number): string {
  return count === 1 ? "bag" : "bags";
}
