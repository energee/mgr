"use client";

/**
 * PlannedAdditions - Show planned fermentation additions from recipe
 *
 * Fetches and displays fermentation additions from the recipe:
 * - Dry hops (recipe_hops where timing = 'dry_hop')
 * - Fruits (recipe_fruits)
 * - Spices (recipe_spices where timing IN fermentation, secondary)
 * - Other additions
 *
 * Shows checkmarks for additions that have been logged (catalog-id exact
 * match, with fuzzy name fallback for custom entries — see
 * planned-addition-matching.ts) and, when `onLog` is provided, a per-card
 * "Log" button so the parent can open the quick-add form prefilled.
 */

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, Circle, Leaf, Apple, Sparkles, Beaker } from "lucide-react";
import type { AdditionType } from "@/domain/batch-additions";
import {
  isPlannedAdditionLogged,
  type PlannedAddition,
} from "@/domain/planned-addition-matching";
import { recipeKeys } from "@/lib/query-keys";
import { log } from "@/lib/client-logger";

// =============================================================================
// Types
// =============================================================================

// Re-export for consumers (e.g. the batch additions page's onLog handler)
export type { PlannedAddition };

/** Row from the batch_additions table */
type BatchAdditionRow = {
  id: string;
  addition_type: string;
  catalog_id: string | null;
  name: string;
  amount: number;
  unit: string;
}

type PlannedAdditionsProps = {
  recipeId: string;
  actualAdditions: BatchAdditionRow[];
  /** When provided, un-logged cards render a "Log" button that invokes this with the planned addition */
  onLog?: (addition: PlannedAddition) => void;
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

export function PlannedAdditions({
  recipeId,
  actualAdditions,
  onLog,
  className,
}: PlannedAdditionsProps) {
  const supabase = createClient();

  // Fetch planned additions from recipe
  const { data: plannedAdditions, isLoading, error } = useQuery({
    queryKey: recipeKeys.fermentationAdditions(recipeId),
    queryFn: async () => {
      try {
        const additions: PlannedAddition[] = [];

        // Dry hops
        const { data: dryHops } = await supabase
          .from("recipe_hops")
          .select("id, hop_id, weight_oz, notes, hop:hops(name)")
          .eq("recipe_id", recipeId)
          .eq("timing", "dry_hop");

        if (dryHops) {
          dryHops.forEach((h) => {
            const hop = h.hop as { name: string } | null;
            additions.push({
              id: h.id,
              catalogId: h.hop_id,
              type: "dry_hop",
              name: hop?.name || "Unknown hop",
              amount: h.weight_oz,
              unit: "oz",
              notes: h.notes || undefined,
            });
          });
        }

        // Fruits
        const { data: fruits } = await supabase
          .from("recipe_fruits")
          .select("id, fruit_id, amount, unit, timing, notes, fruit:fruits(name)")
          .eq("recipe_id", recipeId);

        if (fruits) {
          fruits.forEach((f) => {
            const fruit = f.fruit as { name: string } | null;
            additions.push({
              id: f.id,
              catalogId: f.fruit_id,
              type: "fruit",
              name: fruit?.name || "Unknown fruit",
              amount: f.amount,
              unit: f.unit,
              timing: f.timing || undefined,
              notes: f.notes || undefined,
            });
          });
        }

        // Spices (fermentation/secondary timing)
        const { data: spices } = await supabase
          .from("recipe_spices")
          .select("id, spice_id, amount, unit, timing, notes, spice:spices(name)")
          .eq("recipe_id", recipeId)
          .in("timing", ["fermentation", "secondary"]);

        if (spices) {
          spices.forEach((s) => {
            const spice = s.spice as { name: string } | null;
            additions.push({
              id: s.id,
              catalogId: s.spice_id,
              type: "spice",
              name: spice?.name || "Unknown spice",
              amount: s.amount,
              unit: s.unit,
              timing: s.timing || undefined,
              notes: s.notes || undefined,
            });
          });
        }

        // Adjuncts (fermentation timing)
        const { data: adjuncts } = await supabase
          .from("recipe_adjuncts")
          .select("id, adjunct_id, weight_lbs, notes, adjunct:adjuncts(name)")
          .eq("recipe_id", recipeId)
          .eq("timing", "fermentation");

        if (adjuncts) {
          adjuncts.forEach((a) => {
            const adjunct = a.adjunct as { name: string } | null;
            additions.push({
              id: a.id,
              catalogId: a.adjunct_id,
              type: "adjunct",
              name: adjunct?.name || "Unknown adjunct",
              amount: a.weight_lbs,
              unit: "lbs",
              notes: a.notes || undefined,
            });
          });
        }

        return additions;
      } catch (err) {
        log.error("Failed to load planned additions:", err);
        throw err;
      }
    },
    enabled: !!recipeId,
  });

  // Check if an addition has been logged (see planned-addition-matching.ts)
  const isAdditionLogged = (planned: PlannedAddition): boolean =>
    isPlannedAdditionLogged(planned, actualAdditions);

  // Get total planned vs completed
  const totalPlanned = plannedAdditions?.length || 0;
  const totalCompleted = plannedAdditions?.filter(isAdditionLogged).length || 0;

  const getIcon = (type: AdditionType) => {
    switch (type) {
      case "dry_hop":
        return Leaf;
      case "fruit":
        return Apple;
      case "fining":
        return Sparkles;
      default:
        return Beaker;
    }
  };

  if (error) {
    return (
      <Card className={className}>
        <CardContent className="py-8 text-center text-destructive">
          Failed to load planned additions
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return null;
  }

  if (!plannedAdditions || plannedAdditions.length === 0) {
    return null;
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Planned from Recipe</CardTitle>
          <Badge variant={totalCompleted === totalPlanned ? "default" : "secondary"}>
            {totalCompleted}/{totalPlanned} complete
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {plannedAdditions.map((addition) => {
            const isComplete = isAdditionLogged(addition);
            const Icon = getIcon(addition.type);

            return (
              <div
                key={addition.id}
                className={`flex items-center gap-3 p-3 rounded-lg border ${
                  isComplete
                    ? "bg-muted/50 border-muted"
                    : "border-border"
                }`}
              >
                <div
                  className={`flex-shrink-0 ${
                    isComplete ? "text-green-600" : "text-muted-foreground"
                  }`}
                >
                  {isComplete ? (
                    <Check className="h-5 w-5" />
                  ) : (
                    <Circle className="h-5 w-5" />
                  )}
                </div>
                <Icon
                  className={`h-4 w-4 flex-shrink-0 ${
                    isComplete ? "text-muted-foreground" : "text-foreground"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-medium ${
                        isComplete ? "line-through text-muted-foreground" : ""
                      }`}
                    >
                      {addition.name}
                    </span>
                    <span className="text-muted-foreground">
                      {addition.amount} {addition.unit}
                    </span>
                  </div>
                  {addition.timing && (
                    <p className="text-xs text-muted-foreground capitalize">
                      {addition.timing.replace("_", " ")}
                    </p>
                  )}
                </div>
                {!isComplete && onLog && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-shrink-0"
                    onClick={() => onLog(addition)}
                    aria-label={`Log ${addition.name}`}
                  >
                    Log
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
