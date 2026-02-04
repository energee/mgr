"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { recipeKeys } from "@/lib/query-keys";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import type { Database } from "@/types/supabase";

type RecipeRow = Database["public"]["Tables"]["recipes"]["Row"];

// SRM to approximate hex color
function srmToColor(srm: number | null): string {
  if (!srm) return "#FFE699";
  const colors = [
    "#FFE699", "#FFD878", "#FFCA5A", "#FFBF42", "#FBB123",
    "#F8A600", "#F39C00", "#EA8F00", "#E58500", "#DE7C00",
    "#D77200", "#CF6900", "#CB6200", "#C35900", "#BB5100",
    "#B54C00", "#A63E00", "#A13700", "#9B3200", "#952D00",
    "#8E2900", "#882300", "#821E00", "#7B1A00", "#771900",
    "#701400", "#6A0E00", "#660D00", "#5E0B00", "#5A0A02",
    "#560A05", "#520907", "#4C0505", "#470606", "#440607",
    "#3F0708", "#3B0607", "#3A0607", "#360607", "#340607",
  ];
  const idx = Math.min(Math.max(Math.round(srm) - 1, 0), colors.length - 1);
  return colors[idx];
}

function sgToPlato(sg: number | null): string {
  if (!sg) return "—";
  const plato = (-1 * 616.868 + 1111.14 * sg - 630.272 * sg * sg + 135.997 * sg * sg * sg);
  return `${plato.toFixed(1)}°P`;
}

interface SidebarSectionProps {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function SidebarSection({
  title,
  subtitle,
  defaultOpen = true,
  children,
}: SidebarSectionProps) {
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger className="flex w-full items-center justify-between py-1.5 text-sm font-medium hover:text-foreground/80">
        <div className="flex items-center gap-2">
          <span>{title}</span>
          {subtitle && (
            <span className="text-xs text-muted-foreground font-normal">
              {subtitle}
            </span>
          )}
        </div>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1">{children}</CollapsibleContent>
    </Collapsible>
  );
}

interface RecipeBuilderSidebarProps {
  recipeId: string;
  recipe: RecipeRow;
}

export function RecipeBuilderSidebar({
  recipeId,
  recipe,
}: RecipeBuilderSidebarProps) {
  const supabase = createClient();

  // Fetch estimates from the view
  const { data: estimates } = useQuery({
    queryKey: recipeKeys.estimates(recipeId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipes_with_estimates")
        .select(
          "est_og, est_fg, est_abv, est_ibu, est_srm, style_name"
        )
        .eq("id", recipeId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Fetch COGS
  const { data: cogs } = useQuery({
    queryKey: recipeKeys.cogs(recipeId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipes_with_cogs")
        .select("*")
        .eq("id", recipeId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Fetch grain bill summary
  const { data: malts = [] } = useQuery({
    queryKey: recipeKeys.grainBill(recipeId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipe_malts")
        .select("weight_lbs, malt:malts(name)")
        .eq("recipe_id", recipeId)
        .order("position");
      if (error) throw error;
      return data;
    },
  });

  // Fetch hops summary
  const { data: hops = [] } = useQuery({
    queryKey: recipeKeys.hopSchedule(recipeId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipe_hops")
        .select("weight_oz, timing, hop:hops(name)")
        .eq("recipe_id", recipeId)
        .order("position");
      if (error) throw error;
      return data;
    },
  });

  // Fetch yeasts summary
  const { data: yeasts = [] } = useQuery({
    queryKey: recipeKeys.yeasts(recipeId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipe_yeasts")
        .select("is_primary, yeast:yeasts(name)")
        .eq("recipe_id", recipeId)
        .order("position");
      if (error) throw error;
      return data;
    },
  });

  // Fetch water profile
  const { data: waterProfile } = useQuery({
    queryKey: ["water-profile", recipe.water_profile_id],
    queryFn: async () => {
      if (!recipe.water_profile_id) return null;
      const { data, error } = await supabase
        .from("water_profiles")
        .select("*")
        .eq("id", recipe.water_profile_id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!recipe.water_profile_id,
  });

  const estAbv = estimates?.est_abv;
  const estOg = estimates?.est_og;
  const estFg = estimates?.est_fg;
  const estIbu = estimates?.est_ibu;
  const estSrm = estimates?.est_srm;

  const mashSchedule = (recipe.mash_schedule as { temp_f?: number; duration_min?: number; name?: string }[] | null) ?? [];
  const fermSchedule = (recipe.fermentation_schedule as { temp_f?: number; duration_days?: number; name?: string; stage?: string }[] | null) ?? [];
  const totalMashMin = mashSchedule.reduce((sum, s) => sum + (s.duration_min || 0), 0);
  const totalFermDays = fermSchedule.reduce((sum, s) => sum + (s.duration_days || 0), 0);

  const dryHops = hops.filter(
    (h) => h.timing === "dry_hop"
  );

  const fmt = (n: number | null | undefined) =>
    n != null ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";

  // SO4:Cl ratio
  const sulfate = waterProfile?.sulfate_ppm ?? 0;
  const chloride = waterProfile?.chloride_ppm ?? 0;
  const ratio = chloride > 0 ? (sulfate / chloride).toFixed(2) : "—";
  const ratioLabel =
    typeof ratio === "string"
      ? ""
      : Number(ratio) > 2
        ? "Hoppy"
        : Number(ratio) < 0.8
          ? "Malty"
          : "Balanced";

  return (
    <div className="space-y-4">
      {/* Vitals Bar */}
      <div className="rounded-lg border bg-card p-3">
        <div className="flex items-center gap-3 text-sm">
          <div
            className="h-5 w-5 rounded-sm border"
            style={{ backgroundColor: srmToColor(estSrm as number | null) }}
            title={`SRM ${estSrm ?? "—"}`}
          />
          <span className="font-semibold">
            {estAbv != null ? `${Number(estAbv).toFixed(1)}%` : "—"} ABV
          </span>
          <span className="text-muted-foreground">
            OG {sgToPlato(estOg as number | null)}
          </span>
          <span className="text-muted-foreground">
            FG {sgToPlato(estFg as number | null)}
          </span>
          <span className="text-muted-foreground">
            IBU {estIbu ?? "—"}
          </span>
        </div>
      </div>

      {/* Water Chemistry Snapshot */}
      {waterProfile && (
        <div className="rounded-lg border bg-card p-3 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              pH {waterProfile.ph ?? "—"} &middot; SO₄:Cl{" "}
              {typeof ratio === "string" ? ratio : `1:${(1 / Number(ratio)).toFixed(2)}`}
            </span>
            {ratioLabel && (
              <Badge variant="outline" className="text-xs">
                {ratioLabel}
              </Badge>
            )}
          </div>
          <div className="flex gap-2 text-xs text-muted-foreground">
            <span>Ca {waterProfile.calcium_ppm ?? 0}</span>
            <span>Mg {waterProfile.magnesium_ppm ?? 0}</span>
            <span>Na {waterProfile.sodium_ppm ?? 0}</span>
            <span>SO₄ {waterProfile.sulfate_ppm ?? 0}</span>
            <span>Cl {waterProfile.chloride_ppm ?? 0}</span>
            <span>HCO₃ {waterProfile.bicarbonate_ppm ?? 0}</span>
          </div>
        </div>
      )}

      {/* Ingredients Summary */}
      <div className="rounded-lg border bg-card p-3">
        <SidebarSection
          title="Ingredients"
          subtitle={`${malts.length} malts · ${hops.length} hops${yeasts.length ? " · yeast" : ""}`}
        >
          <div className="space-y-3 text-sm">
            {malts.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  Grain Bill
                </div>
                {malts.map((m, i) => (
                  <div key={i} className="flex justify-between text-xs py-0.5">
                    <span className="truncate">
                      {(m.malt as { name: string } | null)?.name ?? "Unknown"}
                    </span>
                    <span className="text-muted-foreground ml-2 shrink-0">
                      {m.weight_lbs} lbs
                    </span>
                  </div>
                ))}
              </div>
            )}
            {hops.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  Hops
                </div>
                {hops.map((h, i) => (
                  <div key={i} className="flex justify-between text-xs py-0.5">
                    <span className="truncate">
                      {(h.hop as { name: string } | null)?.name ?? "Unknown"}
                    </span>
                    <span className="text-muted-foreground ml-2 shrink-0">
                      {h.weight_oz} lbs{" "}
                      {h.timing === "dry_hop"
                        ? "DH"
                        : h.timing === "whirlpool"
                          ? "WP"
                          : h.timing === "first_wort"
                            ? "FW"
                            : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {yeasts.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  Yeast
                </div>
                {yeasts.map((y, i) => (
                  <div key={i} className="text-xs py-0.5">
                    {(y.yeast as { name: string } | null)?.name ?? "Unknown"}
                  </div>
                ))}
              </div>
            )}
          </div>
        </SidebarSection>
      </div>

      {/* Cost Breakdown */}
      {cogs && (cogs.total_cogs ?? 0) > 0 && (
        <div className="rounded-lg border bg-card p-3">
          <SidebarSection
            title="Cost Breakdown"
            subtitle={fmt(cogs.cogs_per_bbl) + "/BBL"}
            defaultOpen={false}
          >
            <div className="space-y-1 text-xs">
              {(cogs.malt_cost ?? 0) > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Malts</span>
                  <span>{fmt(cogs.malt_cost)}</span>
                </div>
              )}
              {(cogs.hop_cost ?? 0) > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Hops</span>
                  <span>{fmt(cogs.hop_cost)}</span>
                </div>
              )}
              {(cogs.yeast_cost ?? 0) > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Yeast</span>
                  <span>{fmt(cogs.yeast_cost)}</span>
                </div>
              )}
              {(cogs.adjunct_cost ?? 0) > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Adjuncts</span>
                  <span>{fmt(cogs.adjunct_cost)}</span>
                </div>
              )}
              {(cogs.addition_cost ?? 0) > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Additions</span>
                  <span>{fmt(cogs.addition_cost)}</span>
                </div>
              )}
              <div className="flex justify-between font-medium border-t pt-1 mt-1">
                <span>Total</span>
                <span>{fmt(cogs.total_cogs)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Per BBL</span>
                <span>{fmt(cogs.cogs_per_bbl)}</span>
              </div>
            </div>
          </SidebarSection>
        </div>
      )}

      {/* Mash Summary */}
      {mashSchedule.length > 0 && (
        <div className="rounded-lg border bg-card p-3">
          <SidebarSection
            title="Mash"
            subtitle={`${mashSchedule.length} step${mashSchedule.length !== 1 ? "s" : ""} · ${totalMashMin} min`}
          >
            <div className="space-y-0.5 text-xs">
              {mashSchedule.map((step, i) => (
                <div key={i} className="flex justify-between text-muted-foreground">
                  <span>{step.name || "Step"}</span>
                  <span>
                    {step.temp_f}°F · {step.duration_min} min
                  </span>
                </div>
              ))}
            </div>
          </SidebarSection>
        </div>
      )}

      {/* Fermentation Summary */}
      {fermSchedule.length > 0 && (
        <div className="rounded-lg border bg-card p-3">
          <SidebarSection
            title="Fermentation"
            subtitle={`${fermSchedule.length} stage${fermSchedule.length !== 1 ? "s" : ""} · ${totalFermDays} days`}
          >
            <div className="space-y-1 text-xs">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Temperature Profile
              </div>
              {fermSchedule.map((stage, i) => (
                <div
                  key={i}
                  className="flex justify-between text-muted-foreground"
                >
                  <span>{stage.name || stage.stage || "Stage"}</span>
                  <span>
                    {stage.temp_f}°F · {stage.duration_days}d
                  </span>
                </div>
              ))}
              <div className="flex justify-between font-medium border-t pt-1 mt-1 text-foreground">
                <span>Total</span>
                <span>{totalFermDays} days</span>
              </div>
            </div>
          </SidebarSection>
        </div>
      )}

      {/* Dry Hops */}
      {dryHops.length > 0 && (
        <div className="rounded-lg border bg-card p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
            Dry Hops
          </div>
          {dryHops.map((h, i) => (
            <div key={i} className="flex justify-between text-xs py-0.5">
              <span>
                {(h.hop as { name: string } | null)?.name ?? "Unknown"}
              </span>
              <span className="text-muted-foreground">
                {h.weight_oz} lbs
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
