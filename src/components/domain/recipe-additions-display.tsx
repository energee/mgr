"use client";

/**
 * RecipeAdditionsDisplay - Display component for recipe additions
 *
 * Read-only display of water chemistry additions, clarifiers, nutrients, etc.
 * for the recipe detail view. Fetches data from recipe_additions junction table.
 */

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FlaskConical } from "lucide-react";

// Timing labels
const TIMING_LABELS: Record<string, string> = {
  mash: "Mash",
  sparge: "Sparge",
  boil: "Boil",
  whirlpool: "Whirlpool",
  fermentation: "Fermentation",
  packaging: "Packaging",
};

// Target labels (for water salts)
const TARGET_LABELS: Record<string, string> = {
  mash: "Mash Water",
  sparge: "Sparge Water",
  kettle: "Kettle",
};

// Additive type labels
const TYPE_LABELS: Record<string, string> = {
  water_salt: "Water Salt",
  acid: "Acid",
  clarifier: "Clarifier",
  nutrient: "Nutrient",
  antifoam: "Antifoam",
  other: "Other",
};

// Type colors for badges
const TYPE_COLORS: Record<string, string> = {
  water_salt: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  acid: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  clarifier: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  nutrient: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  antifoam: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  other: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
};

interface AdditionRow {
  id: string;
  additive_id: string;
  amount: number;
  unit: string;
  timing: string;
  target: string | null;
  position: number | null;
  additive: {
    id: string;
    name: string;
    type: string;
    description: string | null;
  } | null;
}

interface RecipeAdditionsDisplayProps {
  data: { id: string | null };
}

export function RecipeAdditionsDisplay({ data }: RecipeAdditionsDisplayProps) {
  const supabase = createClient();
  const recipeId = data.id;

  // Hook must be called unconditionally - use enabled option to prevent query when no ID
  const { data: additions, isLoading } = useQuery({
    queryKey: ["recipe-additions", recipeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipe_additions")
        .select(`
          id,
          additive_id,
          amount,
          unit,
          timing,
          target,
          position,
          additive:additives (
            id,
            name,
            type,
            description
          )
        `)
        .eq("recipe_id", recipeId!)
        .order("position", { ascending: true });

      if (error) throw error;
      return data as AdditionRow[];
    },
    enabled: !!recipeId,
  });

  // Handle null recipe ID (after hooks)
  if (!recipeId) {
    return (
      <div className="text-center text-muted-foreground py-6">
        <FlaskConical className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p>Recipe not saved yet</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (!additions || additions.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-6">
        <FlaskConical className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p>No additions defined</p>
        <p className="text-sm mt-1">
          Add water salts, clarifiers, nutrients, and other additions to this recipe
        </p>
      </div>
    );
  }

  // Group additions by timing for better organization
  const groupedByTiming = additions.reduce((acc, addition) => {
    const timing = addition.timing;
    if (!acc[timing]) acc[timing] = [];
    acc[timing].push(addition);
    return acc;
  }, {} as Record<string, AdditionRow[]>);

  return (
    <div className="space-y-4">
      {Object.entries(groupedByTiming).map(([timing, items]) => (
        <div key={timing}>
          <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
            <Badge variant="outline">{TIMING_LABELS[timing] || timing}</Badge>
            <span className="text-muted-foreground text-xs">
              ({items.length} {items.length === 1 ? "addition" : "additions"})
            </span>
          </h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Additive</TableHead>
                <TableHead className="w-24">Type</TableHead>
                <TableHead className="w-28 text-right">Amount</TableHead>
                {timing === "mash" || timing === "sparge" ? (
                  <TableHead className="w-28">Target</TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((addition) => (
                <TableRow key={addition.id}>
                  <TableCell>
                    <div>
                      <span className="font-medium">
                        {addition.additive?.name || "Unknown"}
                      </span>
                      {addition.additive?.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {addition.additive.description}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={TYPE_COLORS[addition.additive?.type || "other"]}
                    >
                      {TYPE_LABELS[addition.additive?.type || "other"]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {addition.amount} {addition.unit}
                  </TableCell>
                  {(timing === "mash" || timing === "sparge") && (
                    <TableCell>
                      {addition.target
                        ? TARGET_LABELS[addition.target] || addition.target
                        : "—"}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}
    </div>
  );
}
