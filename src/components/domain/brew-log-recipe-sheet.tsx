"use client";

/**
 * BrewLogRecipeSheet - Slide-over recipe reference for brew day
 *
 * Shows the associated recipe in a non-modal right-side Sheet so the brewer
 * can reference grain bill, hop schedule, mash steps, and targets while
 * recording brew events. On desktop the sheet sits alongside the brew log.
 */

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { recipeKeys } from "@/lib/query-keys";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { UnitDisplay } from "@/components/ui/unit-input";
import { Beer } from "lucide-react";

// =============================================================================
// Types
// =============================================================================

interface RecipeData {
  id: string;
  name: string;
  style_name: string | null;
  volume_bbl: number | null;
  batch_size_bbl: number | null;
  mash_water_volume_gal: number | null;
  sparge_water_volume_gal: number | null;
  preboil_volume_bbl: number | null;
  target_ko_volume_bbl: number | null;
  boil_time_min: number | null;
  mash_temp_f: number | null;
  mash_efficiency: number | null;
  target_mash_ph: number | null;
  water_to_grain_ratio: number | null;
  whirlpool_time_min: number | null;
  whirlpool_temp_f: number | null;
  target_ko_temp_f: number | null;
  target_pitching_rate: number | null;
  fermentation_days: number | null;
  conditioning_days: number | null;
  est_og: number | null;
  est_fg: number | null;
  est_abv: number | null;
  est_ibu: number | null;
  est_srm: number | null;
  mash_schedule: MashStep[] | null;
  fermentation_schedule: FermentationStage[] | null;
  brew_day_notes: string | null;
}

interface MashStep {
  name: string;
  step_type: string;
  temp_f: number;
  duration_min: number;
}

interface FermentationStage {
  name: string;
  stage: string;
  temp_f: number;
  duration_days: number;
}

interface GrainBillRow {
  id: string;
  weight_lbs: number;
  position: number | null;
  malt: { name: string; type: string | null } | null;
}

interface HopScheduleRow {
  id: string;
  weight_oz: number;
  timing: string;
  boil_time_min: number | null;
  alpha_acid: number | null;
  position: number | null;
  hop: { name: string; type: string | null } | null;
}

// =============================================================================
// Props
// =============================================================================

interface BrewLogRecipeSheetProps {
  recipeId: string;
  recipeName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// =============================================================================
// Timing display config (label + sort order)
// =============================================================================

const TIMING_CONFIG: Record<string, { label: string; order: number }> = {
  first_wort: { label: "First Wort", order: 0 },
  boil: { label: "Boil", order: 1 },
  whirlpool: { label: "Whirlpool", order: 2 },
  dry_hop: { label: "Dry Hop", order: 3 },
};

// =============================================================================
// Component
// =============================================================================

export function BrewLogRecipeSheet({
  recipeId,
  recipeName,
  open,
  onOpenChange,
}: BrewLogRecipeSheetProps) {
  const supabase = createClient();

  // Recipe details + estimates + schedules
  const { data: recipe, isLoading: recipeLoading } = useQuery({
    queryKey: recipeKeys.summary(recipeId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipes_with_estimates")
        .select(
          `id, name, style_name, volume_bbl, batch_size_bbl,
           mash_water_volume_gal, sparge_water_volume_gal, preboil_volume_bbl,
           target_ko_volume_bbl, boil_time_min, mash_temp_f, mash_efficiency,
           target_mash_ph, water_to_grain_ratio, whirlpool_time_min,
           whirlpool_temp_f, target_ko_temp_f, target_pitching_rate,
           fermentation_days, conditioning_days, est_og, est_fg, est_abv,
           est_ibu, est_srm, mash_schedule, fermentation_schedule, brew_day_notes`
        )
        .eq("id", recipeId)
        .single();
      if (error) throw error;
      return data as unknown as RecipeData;
    },
    enabled: open,
  });

  // Grain bill
  const { data: grainBill } = useQuery({
    queryKey: recipeKeys.grainBill(recipeId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipe_malts")
        .select("id, weight_lbs, position, malt:malts(name, type)")
        .eq("recipe_id", recipeId)
        .order("position");
      if (error) throw error;
      return (data ?? []) as unknown as GrainBillRow[];
    },
    enabled: open,
  });

  // Hop schedule
  const { data: hopSchedule } = useQuery({
    queryKey: recipeKeys.hopSchedule(recipeId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipe_hops")
        .select(
          "id, weight_oz, timing, boil_time_min, alpha_acid, position, hop:hops(name, type)"
        )
        .eq("recipe_id", recipeId)
        .order("position");
      if (error) throw error;
      return (data ?? []) as unknown as HopScheduleRow[];
    },
    enabled: open,
  });

  const totalGrainWeight =
    grainBill?.reduce((sum, g) => sum + g.weight_lbs, 0) ?? 0;

  // Sort hops by timing order, then by boil time descending
  const sortedHops = [...(hopSchedule ?? [])].sort((a, b) => {
    const orderDiff =
      (TIMING_CONFIG[a.timing]?.order ?? 99) - (TIMING_CONFIG[b.timing]?.order ?? 99);
    if (orderDiff !== 0) return orderDiff;
    return (b.boil_time_min ?? 0) - (a.boil_time_min ?? 0);
  });

  const mashSteps = Array.isArray(recipe?.mash_schedule)
    ? recipe.mash_schedule
    : [];
  const fermStages = Array.isArray(recipe?.fermentation_schedule)
    ? recipe.fermentation_schedule
    : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="right"
        overlay={false}
        className="w-full sm:max-w-md overflow-y-auto"
        onInteractOutside={(e) => {
          // On desktop (sm+), keep sheet open while using the form
          if (window.innerWidth >= 640) e.preventDefault();
        }}
        onFocusOutside={(e) => {
          if (window.innerWidth >= 640) e.preventDefault();
        }}
      >
        <SheetHeader>
          <div className="flex items-center gap-2">
            <Beer className="h-5 w-5 text-muted-foreground" />
            <SheetTitle className="text-lg">{recipeName}</SheetTitle>
          </div>
          {recipe?.style_name && (
            <SheetDescription>{recipe.style_name}</SheetDescription>
          )}
        </SheetHeader>

        {recipeLoading ? (
          <div className="space-y-4 px-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : recipe ? (
          <div className="space-y-6 px-4 pb-8">
            {/* Targets */}
            <Section title="Targets">
              <div className="grid grid-cols-5 gap-2 text-center">
                <StatBox label="OG" value={recipe.est_og?.toFixed(3)} />
                <StatBox label="FG" value={recipe.est_fg?.toFixed(3)} />
                <StatBox label="ABV" value={recipe.est_abv ? `${recipe.est_abv.toFixed(1)}%` : undefined} />
                <StatBox label="IBU" value={recipe.est_ibu?.toFixed(0)} />
                <StatBox label="SRM" value={recipe.est_srm?.toFixed(1)} />
              </div>
            </Section>

            {/* Volumes */}
            <Section title="Volumes">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <DataRow label="Batch Size" value={recipe.batch_size_bbl != null ? <UnitDisplay value={recipe.batch_size_bbl} unitType="volume" /> : null} />
                <DataRow label="KO Target" value={recipe.target_ko_volume_bbl != null ? <UnitDisplay value={recipe.target_ko_volume_bbl} unitType="volume" /> : null} />
                {recipe.mash_water_volume_gal != null && (
                  <DataRow label="Mash Water" value={`${recipe.mash_water_volume_gal} gal`} />
                )}
                {recipe.sparge_water_volume_gal != null && (
                  <DataRow label="Sparge Water" value={`${recipe.sparge_water_volume_gal} gal`} />
                )}
              </div>
            </Section>

            {/* Grain Bill */}
            {grainBill && grainBill.length > 0 && (
              <Section title="Grain Bill">
                <div className="space-y-1.5">
                  {grainBill.map((g) => {
                    const pct = totalGrainWeight > 0
                      ? ((g.weight_lbs / totalGrainWeight) * 100).toFixed(1)
                      : "0";
                    return (
                      <div key={g.id} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="truncate">{g.malt?.name ?? "Unknown"}</span>
                          {g.malt?.type && (
                            <Badge variant="outline" className="text-[10px] shrink-0">
                              {g.malt.type}
                            </Badge>
                          )}
                        </div>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          <UnitDisplay value={g.weight_lbs} unitType="weight" decimals={1} />
                          <span className="ml-1 text-xs">({pct}%)</span>
                        </span>
                      </div>
                    );
                  })}
                  <div className="border-t pt-1 text-sm font-medium flex justify-between">
                    <span>Total</span>
                    <UnitDisplay value={totalGrainWeight} unitType="weight" decimals={1} />
                  </div>
                </div>
              </Section>
            )}

            {/* Mash Schedule */}
            {mashSteps.length > 0 && (
              <Section title="Mash Schedule">
                <div className="space-y-1.5">
                  {mashSteps.map((step, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span>{step.name}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        <UnitDisplay value={step.temp_f} unitType="temperature" decimals={0} />
                        <span className="ml-1 text-xs">{step.duration_min} min</span>
                      </span>
                    </div>
                  ))}
                </div>
                {recipe.target_mash_ph && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Target pH: {recipe.target_mash_ph}
                    {recipe.water_to_grain_ratio && ` | Ratio: ${recipe.water_to_grain_ratio} qt/lb`}
                  </p>
                )}
              </Section>
            )}

            {/* Mash (fallback if no schedule but has temp) */}
            {mashSteps.length === 0 && recipe.mash_temp_f && (
              <Section title="Mash">
                <div className="text-sm">
                  <DataRow
                    label="Mash Temp"
                    value={<UnitDisplay value={recipe.mash_temp_f} unitType="temperature" decimals={0} />}
                  />
                  {recipe.target_mash_ph && (
                    <DataRow label="Target pH" value={recipe.target_mash_ph} />
                  )}
                  {recipe.mash_efficiency && (
                    <DataRow label="Efficiency" value={`${recipe.mash_efficiency}%`} />
                  )}
                </div>
              </Section>
            )}

            {/* Boil & Hop Schedule */}
            {(sortedHops.length > 0 || recipe.boil_time_min) && (
              <Section title={`Boil${recipe.boil_time_min ? ` (${recipe.boil_time_min} min)` : ""}`}>
                {sortedHops.length > 0 && (
                  <div className="space-y-1.5">
                    {sortedHops.map((h) => (
                      <div key={h.id} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="truncate">{h.hop?.name ?? "Unknown"}</span>
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            {TIMING_CONFIG[h.timing]?.label ?? h.timing}
                            {h.timing === "boil" && h.boil_time_min != null && ` ${h.boil_time_min}m`}
                          </Badge>
                        </div>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {h.weight_oz} oz
                          {h.alpha_acid != null && (
                            <span className="ml-1 text-xs">({h.alpha_acid}% AA)</span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            )}

            {/* Whirlpool & Knockout */}
            {(recipe.whirlpool_time_min || recipe.target_ko_temp_f) && (
              <Section title="Whirlpool & Knockout">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  {recipe.whirlpool_time_min && (
                    <DataRow label="Whirlpool" value={`${recipe.whirlpool_time_min} min`} />
                  )}
                  {recipe.whirlpool_temp_f && (
                    <DataRow label="WP Temp" value={<UnitDisplay value={recipe.whirlpool_temp_f} unitType="temperature" decimals={0} />} />
                  )}
                  {recipe.target_ko_temp_f && (
                    <DataRow label="KO Temp" value={<UnitDisplay value={recipe.target_ko_temp_f} unitType="temperature" decimals={0} />} />
                  )}
                  {recipe.target_pitching_rate && (
                    <DataRow label="Pitch Rate" value={`${recipe.target_pitching_rate} M/mL/°P`} />
                  )}
                </div>
              </Section>
            )}

            {/* Fermentation */}
            {fermStages.length > 0 && (
              <Section title="Fermentation">
                <div className="space-y-1.5">
                  {fermStages.map((stage, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span>{stage.name}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        <UnitDisplay value={stage.temp_f} unitType="temperature" decimals={0} />
                        <span className="ml-1 text-xs">{stage.duration_days}d</span>
                      </span>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Brew Day Notes */}
            {recipe.brew_day_notes && (
              <Section title="Brew Day Notes">
                <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                  {recipe.brew_day_notes}
                </p>
              </Section>
            )}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

function StatBox({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value ?? "—"}</div>
    </div>
  );
}

function DataRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  if (value == null) return null;
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
