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
import type { GrainBillItem } from "@/components/domain/recipe/grain-bill-editor";
import type { HopScheduleItem } from "@/components/domain/recipe/hop-schedule-editor";
import { StatusBadge } from "@/components/universal/status-badge";
import { recipeEntity } from "@/entities/recipe";
import { useGravityUnit, useWeightUnit } from "@/hooks/use-unit-preferences";
import { formatGravityFromSg, convertWeight, UNIT_LABELS, type WeightUnit } from "@/lib/units";

/** SRM-to-hex color lookup table for continuous beer color display */
const SRM_COLORS: [number, string][] = [
  [0, "#FFE699"], [2, "#FFD878"], [4, "#FFCA5A"], [6, "#FFBF42"],
  [8, "#FBB123"], [10, "#F8A600"], [13, "#E58500"], [17, "#CE6B00"],
  [20, "#A85600"], [24, "#8D4C00"], [29, "#6B3A00"], [35, "#4C2900"],
  [40, "#361F00"],
];

/** Map SRM value to hex color for the beer color indicator */
function srmToHex(srm: number | null): string {
  if (!srm || srm <= 0) return SRM_COLORS[0][1];
  for (let i = SRM_COLORS.length - 1; i >= 0; i--) {
    if (srm >= SRM_COLORS[i][0]) return SRM_COLORS[i][1];
  }
  return SRM_COLORS[0][1];
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

/** Format a grain weight (canonical lbs) using the user's preferred weight unit. */
function formatGrainWeight(lbs: number, unit: WeightUnit): string {
  return `${formatNum(convertWeight(lbs, "lbs", unit))} ${UNIT_LABELS[unit]}`;
}

/**
 * Format a hop weight (canonical oz). For lbs preference: shows lbs when ≥1 lb,
 * otherwise oz. For kg preference: always shows kg, with extra precision for
 * sub-pound amounts so dry-hop charges aren't rounded to "0 kg".
 */
function formatHopWeight(oz: number, unit: WeightUnit): string {
  if (unit === "kg") {
    const kg = convertWeight(oz / 16, "lbs", "kg");
    return `${kg.toFixed(kg < 1 ? 3 : 2)} kg`;
  }
  if (oz >= 16) return `${formatNum(oz / 16)} lbs`;
  return `${formatNum(oz)} oz`;
}

function bagLabel(count: number): string {
  return count === 1 ? "bag" : "bags";
}

// =============================================================================
// Component
// =============================================================================

export function RecipeSidebar() {
  const { recipe, estimates, grainItems, hopItems } = useRecipeEditor();
  const gravityUnit = useGravityUnit();
  const weightUnit = useWeightUnit();

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
          <EstimateCard label="OG" value={formatGravityFromSg(estimates.og, gravityUnit)} />
          <EstimateCard label="FG" value={formatGravityFromSg(estimates.fg, gravityUnit)} />
          <EstimateCard label="IBU" value={estimates.ibu?.toString() ?? "\u2014"} />
          <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
            <div
              className="h-4 w-4 rounded-full border"
              style={{ backgroundColor: srmToHex(estimates.srm) }}
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
            <span className="text-xs text-muted-foreground">
              {grainCalc.totalBags} {bagLabel(grainCalc.totalBags)}
            </span>
          )}
        </div>

        {grainCalc.grains.length === 0 ? (
          <p className="text-sm text-muted-foreground">No grains added yet. Add malts in the Fermentables section to see estimates.</p>
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
                    {formatGrainWeight(g.weightLbs, weightUnit)}
                  </span>
                  {g.bags !== null && g.bagWeightLbs ? (
                    <span className="tabular-nums">
                      {g.bags} x {formatGrainWeight(g.bagWeightLbs, weightUnit)} {bagLabel(g.bags)}
                    </span>
                  ) : (
                    <span className="italic">no bag size</span>
                  )}
                </div>
              </div>
            ))}
            {/* Totals row */}
            <div className="border-t pt-1.5 mt-1.5 flex justify-between text-sm font-medium">
              <span>{formatGrainWeight(grainCalc.totalLbs, weightUnit)} total</span>
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
            <span className="text-xs text-muted-foreground">
              {hopCalc.totalBags} {bagLabel(hopCalc.totalBags)}
            </span>
          )}
        </div>

        {hopCalc.hops.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hops added yet. Add hops in the Fermentables section to calculate IBU.</p>
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
                    {formatHopWeight(h.weightOz, weightUnit)}
                  </span>
                  {h.bags !== null && h.bagWeightLbs ? (
                    <span className="tabular-nums">
                      {h.bags} x {formatGrainWeight(h.bagWeightLbs, weightUnit)} {bagLabel(h.bags)}
                    </span>
                  ) : (
                    <span className="italic">no bag size</span>
                  )}
                </div>
              </div>
            ))}
            {/* Totals row */}
            <div className="border-t pt-1.5 mt-1.5 flex justify-between text-sm font-medium">
              <span>{formatHopWeight(hopCalc.totalOz, weightUnit)} total</span>
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
