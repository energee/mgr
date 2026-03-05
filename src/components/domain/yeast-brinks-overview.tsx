"use client";

/**
 * Yeast Brinks Overview
 *
 * Dashboard card grid showing all brink vessels and their current yeast pitches.
 * Displays viability status, remaining quantity, generation, and days until
 * the 75% viability threshold. Empty brinks are shown as dimmed cards.
 */

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { yeastKeys, vesselKeys } from "@/lib/query-keys";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  calculateViabilityDecay,
  getViabilityStatus,
  daysUntilViabilityThreshold,
  type YeastForm,
} from "@/lib/yeast-calculations";

// =============================================================================
// Types
// =============================================================================

interface BrinkVessel {
  id: string;
  name: string;
}

interface ActivePitch {
  id: string;
  strain_name: string | null;
  strain_form: string | null;
  quantity_remaining_lbs: number | null;
  initial_viability: number | null;
  received_date: string | null;
  harvest_date: string | null;
  generation: number | null;
  vessel_id: string | null;
  days_old: number | null;
  estimated_viability: number | null;
  viability_status: string | null;
}

// =============================================================================
// Viability Badge
// =============================================================================

const VIABILITY_BADGE_CLASSES: Record<string, string> = {
  excellent: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  good: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  marginal: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  low: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  inactive: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

function ViabilityBadge({ status }: { status: string }) {
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        VIABILITY_BADGE_CLASSES[status] || VIABILITY_BADGE_CLASSES.inactive
      }`}
    >
      {label}
    </span>
  );
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

  // Fetch active yeast pitches in brinks
  const { data: activePitches, isLoading: pitchesLoading } = useQuery({
    queryKey: yeastKeys.brinks(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("yeast_pitches_with_remaining")
        .select(
          "id, strain_name, strain_form, quantity_remaining_lbs, initial_viability, received_date, harvest_date, generation, vessel_id, days_old, estimated_viability, viability_status"
        )
        .in("status", ["in_stock", "in_use"])
        .not("vessel_id", "is", null);
      if (error) throw error;
      return data as ActivePitch[];
    },
  });

  const isLoading = brinksLoading || pitchesLoading;

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

  // Map vessel_id -> pitch for quick lookup
  const pitchByVessel = new Map<string, ActivePitch>();
  activePitches?.forEach((pitch) => {
    if (pitch.vessel_id) {
      pitchByVessel.set(pitch.vessel_id, pitch);
    }
  });

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

  // Calculate viability from initial values (client-side recalculation)
  const form: YeastForm = (pitch.strain_form as YeastForm) || "liquid";
  const daysOld = pitch.days_old ?? 0;
  const initialViability = pitch.initial_viability ?? 95;
  const viabilityResult = calculateViabilityDecay(initialViability, daysOld, form);
  const viabilityStatus = getViabilityStatus(viabilityResult.viability);
  const daysUntil75 = daysUntilViabilityThreshold(
    viabilityResult.viability,
    75,
    form
  );

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
                ? `${Number(pitch.quantity_remaining_lbs).toFixed(1)} lbs`
                : "\u2014"}
            </span>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Viability</span>
            <div className="flex items-center gap-2">
              <span className="font-medium">{Math.round(viabilityResult.viability)}%</span>
              <ViabilityBadge status={viabilityStatus} />
            </div>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Days to 75%</span>
            <span className="font-medium">
              {viabilityResult.viability <= 75
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
