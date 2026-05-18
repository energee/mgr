"use client";

/**
 * Yeast Brinks Overview
 *
 * Dashboard card grid showing all brink vessels and their current yeast pitches.
 * Displays viability status, remaining quantity, generation, and days until
 * the 75% viability threshold. Empty brinks are shown as dimmed cards.
 *
 * Viability data comes from the yeast_pitches_with_remaining view (single source
 * of truth). The only client-side calculation is days-until-threshold, which
 * requires the decay rate constant from yeast-calculations.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { yeastKeys, vesselKeys } from "@/lib/query-keys";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/universal/status-badge";
import { VIABILITY_STATUS_DISPLAY } from "@/entities/yeast-pitch";
import {
  daysUntilViabilityThreshold,
  type YeastForm,
} from "@/domain/yeast-calculations";
import { useWeightUnit } from "@/hooks/use-unit-preferences";
import { formatWeight } from "@/domain/units";

// =============================================================================
// Types
// =============================================================================

type BrinkVessel = {
  id: string;
  name: string;
}

type ActivePitch = {
  id: string;
  strain_name: string | null;
  strain_form: string | null;
  quantity_remaining_lbs: number | null;
  estimated_viability: number | null;
  viability_status: string | null;
  generation: number | null;
  vessel_id: string | null;
  days_old: number | null;
}

// =============================================================================
// Component
// =============================================================================

export function YeastBrinksOverview() {
  const supabase = createClient();

  // Fetch brink vessels
  const { data: brinks, isLoading: brinksLoading } = useQuery({
    queryKey: vesselKeys.brinks(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vessels")
        .select("id, name")
        .eq("vessel_type", "brink")
        .order("name");
      if (error) throw error;
      return data as BrinkVessel[];
    },
  });

  // Fetch active yeast pitches in brinks — uses view-computed viability fields
  const { data: activePitches, isLoading: pitchesLoading } = useQuery({
    queryKey: yeastKeys.brinks(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("yeast_pitches_with_remaining")
        .select(
          "id, strain_name, strain_form, quantity_remaining_lbs, estimated_viability, viability_status, generation, vessel_id, days_old"
        )
        .in("status", ["in_stock", "in_use"])
        .not("vessel_id", "is", null);
      if (error) throw error;
      return data as ActivePitch[];
    },
  });

  const isLoading = brinksLoading || pitchesLoading;

  // Map vessel_id -> pitch for quick lookup (must be before early returns)
  const pitchByVessel = useMemo(() => {
    const map = new Map<string, ActivePitch>();
    activePitches?.forEach((pitch) => {
      if (pitch.vessel_id) {
        map.set(pitch.vessel_id, pitch);
      }
    });
    return map;
  }, [activePitches]);

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-5 w-32" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-24 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!brinks || brinks.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          No brink vessels found. Add vessels with type &quot;brink&quot; to track yeast.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {brinks.map((brink) => {
        const pitch = pitchByVessel.get(brink.id);
        return (
          <BrinkCard key={brink.id} vessel={brink} pitch={pitch ?? null} />
        );
      })}
    </div>
  );
}

// =============================================================================
// Brink Card
// =============================================================================

function BrinkCard({
  vessel,
  pitch,
}: {
  vessel: BrinkVessel;
  pitch: ActivePitch | null;
}) {
  const weightUnit = useWeightUnit();
  if (!pitch) {
    return (
      <Card className="opacity-50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{vessel.name}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Empty</p>
        </CardContent>
      </Card>
    );
  }

  // Use view-computed viability (single source of truth — avoids duplicate calculation)
  const viability = pitch.estimated_viability ?? 0;
  const viabilityStatus = pitch.viability_status || "good";
  const form: YeastForm = (pitch.strain_form as YeastForm) || "liquid";
  const daysOld = pitch.days_old ?? 0;

  // Days-until-threshold is the one value not in the view (needs decay rate constant)
  const daysUntil75 = daysUntilViabilityThreshold(viability, 75, form);

  return (
    <Link href={`/production/yeast-pitches/${pitch.id}`}>
      <Card className="transition-colors hover:border-primary/50">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">{vessel.name}</CardTitle>
            <Badge variant="outline" className="text-xs">
              G{pitch.generation ?? 1}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm font-medium">{pitch.strain_name || "Unknown strain"}</p>

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Remaining</span>
            <span className="font-medium">
              {pitch.quantity_remaining_lbs != null
                ? formatWeight(Number(pitch.quantity_remaining_lbs), weightUnit, 1)
                : "\u2014"}
            </span>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Viability</span>
            <div className="flex items-center gap-2">
              <span className="font-medium">{Math.round(viability)}%</span>
              <StatusBadge
                status={viabilityStatus}
                config={VIABILITY_STATUS_DISPLAY}
              />
            </div>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Days to 75%</span>
            <span className="font-medium">
              {viability <= 75
                ? "Below threshold"
                : `${daysUntil75}d`}
            </span>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Age</span>
            <span className="font-medium">{daysOld}d</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
