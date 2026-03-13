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
 * Shows checkmarks for additions that have been logged.
 */

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Circle, Leaf, Apple, Sparkles, Beaker } from "lucide-react";
import type { AdditionType } from "@/lib/batch-additions";
import { recipeKeys } from "@/lib/query-keys";
import { log } from "@/lib/client-logger";

// =============================================================================
// Types
// =============================================================================

type PlannedAddition = {
  id: string;
  type: AdditionType;
  name: string;
  amount: number;
  unit: string;
  timing?: string;
  notes?: string;
}

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
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

export function PlannedAdditions({
  recipeId,
  actualAdditions,
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
          .select("id, weight_oz, notes, hop:hops(name)")
          .eq("recipe_id", recipeId)
          .eq("timing", "dry_hop");

        if (dryHops) {
          dryHops.forEach((h) => {
            const hop = h.hop as { name: string } | null;
            additions.push({
              id: h.id,
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
          .select("id, amount, unit, timing, notes, fruit:fruits(name)")
          .eq("recipe_id", recipeId);

        if (fruits) {
          fruits.forEach((f) => {
            const fruit = f.fruit as { name: string } | null;
            additions.push({
              id: f.id,
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
          .select("id, amount, unit, timing, notes, spice:spices(name)")
          .eq("recipe_id", recipeId)
          .in("timing", ["fermentation", "secondary"]);

        if (spices) {
          spices.forEach((s) => {
            const spice = s.spice as { name: string } | null;
            additions.push({
              id: s.id,
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
          .select("id, weight_lbs, notes, adjunct:adjuncts(name)")
          .eq("recipe_id", recipeId)
          .eq("timing", "fermentation");

        if (adjuncts) {
          adjuncts.forEach((a) => {
            const adjunct = a.adjunct as { name: string } | null;
            additions.push({
              id: a.id,
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

  // Map display types to DB types for comparison
  const displayToDb: Record<string, string[]> = {
    dry_hop: ["hop"],
    fruit: ["fruit"],
    adjunct: ["adjunct"],
    fining: ["other"],
    spice: ["spice"],
    other: ["other"],
  };

  // Check if an addition has been logged
  const isAdditionLogged = (planned: PlannedAddition): boolean => {
    return actualAdditions.some((row) => {
      // Match by mapped type first
      const dbTypes = displayToDb[planned.type] || [planned.type];
      if (!dbTypes.includes(row.addition_type)) return false;

      // If catalog_id matches the planned addition id, exact match
      if (planned.id && row.catalog_id === planned.id) return true;

      // Otherwise, use fuzzy name matching
      const actualName = row.name.toLowerCase();
      const plannedName = planned.name.toLowerCase();
      return actualName.includes(plannedName) || plannedName.includes(actualName);
    });
  };

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
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
