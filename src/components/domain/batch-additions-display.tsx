"use client";

/**
 * BatchAdditionsDisplay - Shows actual cold-side additions on a batch detail page.
 *
 * Features:
 * - Displays recorded batch additions in a table
 * - If the batch is linked to a recipe variant, shows planned additions
 *   that haven't been recorded yet as faded/dashed rows
 * - "Add Addition" button links to the batch additions page
 */

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { batchAdditionKeys, recipeVariantKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plus,
  Leaf,
  Droplets,
  Cherry,
  Flame,
  Package,
  MoreHorizontal,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BatchAdditionsDisplayProps {
  data: {
    id: string;
    recipe_variant_id?: string | null;
    [key: string]: unknown;
  };
}

interface BatchAddition {
  id: string;
  addition_type: string;
  name: string;
  amount: number;
  unit: string;
  timing: string | null;
  days: number | null;
  date_added: string | null;
  notes: string | null;
  created_at: string;
}

interface PlannedAddition {
  id: string;
  type: string;
  name: string;
  amount: number;
  unit: string;
  timing: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ADDITION_TYPE_CONFIG: Record<
  string,
  { label: string; icon: React.ElementType }
> = {
  hop: { label: "Hop", icon: Leaf },
  adjunct: { label: "Adjunct", icon: Droplets },
  fruit: { label: "Fruit", icon: Cherry },
  spice: { label: "Spice", icon: Flame },
  yeast: { label: "Yeast", icon: Package },
  other: { label: "Other", icon: MoreHorizontal },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BatchAdditionsDisplay({ data }: BatchAdditionsDisplayProps) {
  const batchId = data.id;
  const recipeVariantId = data.recipe_variant_id;
  const supabase = createClient();

  // Fetch actual additions
  const { data: additions, isLoading: additionsLoading } = useQuery({
    queryKey: batchAdditionKeys.byBatch(batchId),
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("batch_additions")
        .select(
          "id, addition_type, name, amount, unit, timing, days, date_added, notes, created_at"
        )
        .eq("batch_id", batchId)
        .order("created_at");

      if (error) throw error;
      return rows as BatchAddition[];
    },
  });

  // Fetch planned additions from the variant (only if linked)
  const { data: plannedAdditions, isLoading: plannedLoading } = useQuery({
    queryKey: recipeVariantKeys.detail(recipeVariantId ?? ""),
    enabled: !!recipeVariantId,
    queryFn: async () => {
      const planned: PlannedAddition[] = [];

      // Fetch hops
      const { data: hops } = await supabase
        .from("recipe_variant_hops")
        .select("id, weight_oz, timing, days, hop:hops(name)")
        .eq("recipe_variant_id", recipeVariantId!);

      if (hops) {
        for (const h of hops) {
          const hopName =
            (h.hop as unknown as { name: string } | null)?.name ?? "Unknown Hop";
          planned.push({
            id: h.id,
            type: "hop",
            name: hopName,
            amount: Number(h.weight_oz),
            unit: "oz",
            timing: h.timing,
          });
        }
      }

      // Fetch adjuncts
      const { data: adjuncts } = await supabase
        .from("recipe_variant_adjuncts")
        .select("id, amount, unit, timing, adjunct:adjuncts(name)")
        .eq("recipe_variant_id", recipeVariantId!);

      if (adjuncts) {
        for (const a of adjuncts) {
          const adjunctName =
            (a.adjunct as unknown as { name: string } | null)?.name ??
            "Unknown Adjunct";
          planned.push({
            id: a.id,
            type: "adjunct",
            name: adjunctName,
            amount: Number(a.amount),
            unit: a.unit,
            timing: a.timing,
          });
        }
      }

      // Fetch fruits
      const { data: fruits } = await supabase
        .from("recipe_variant_fruits")
        .select("id, amount, unit, timing, fruit:fruits(name)")
        .eq("recipe_variant_id", recipeVariantId!);

      if (fruits) {
        for (const f of fruits) {
          const fruitName =
            (f.fruit as unknown as { name: string } | null)?.name ??
            "Unknown Fruit";
          planned.push({
            id: f.id,
            type: "fruit",
            name: fruitName,
            amount: Number(f.amount),
            unit: f.unit,
            timing: f.timing,
          });
        }
      }

      // Fetch spices
      const { data: spices } = await supabase
        .from("recipe_variant_spices")
        .select("id, amount, unit, timing, spice:spices(name)")
        .eq("recipe_variant_id", recipeVariantId!);

      if (spices) {
        for (const s of spices) {
          const spiceName =
            (s.spice as unknown as { name: string } | null)?.name ??
            "Unknown Spice";
          planned.push({
            id: s.id,
            type: "spice",
            name: spiceName,
            amount: Number(s.amount),
            unit: s.unit,
            timing: s.timing,
          });
        }
      }

      return planned;
    },
  });

  const isLoading = additionsLoading || (recipeVariantId && plannedLoading);

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  // Determine which planned items are still outstanding (not yet recorded)
  const outstandingPlanned = (plannedAdditions ?? []).filter((p) => {
    // A planned item is "fulfilled" if there is an actual addition with
    // matching type and name (case-insensitive)
    return !(additions ?? []).some(
      (a) =>
        a.addition_type === p.type &&
        a.name.toLowerCase() === p.name.toLowerCase()
    );
  });

  const hasAny =
    (additions && additions.length > 0) || outstandingPlanned.length > 0;

  if (!hasAny) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-center">
        <Package className="h-10 w-10 text-muted-foreground/50 mb-3" />
        <p className="text-muted-foreground mb-4">
          No additions recorded for this batch.
        </p>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/production/batches/${batchId}/additions`}>
            <Plus className="mr-1 h-4 w-4" />
            Add Addition
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Timing</TableHead>
            <TableHead>Date Added</TableHead>
            <TableHead>Notes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* Actual additions */}
          {(additions ?? []).map((addition) => {
            const config =
              ADDITION_TYPE_CONFIG[addition.addition_type] ??
              ADDITION_TYPE_CONFIG.other;
            const Icon = config.icon;
            return (
              <TableRow key={addition.id}>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">{config.label}</span>
                  </div>
                </TableCell>
                <TableCell className="font-medium">{addition.name}</TableCell>
                <TableCell>
                  {Number(addition.amount)} {addition.unit}
                </TableCell>
                <TableCell>
                  {formatTiming(addition.timing, addition.days)}
                </TableCell>
                <TableCell>
                  {addition.date_added
                    ? new Date(addition.date_added).toLocaleDateString()
                    : "—"}
                </TableCell>
                <TableCell className="text-muted-foreground max-w-[200px] truncate">
                  {addition.notes || "—"}
                </TableCell>
              </TableRow>
            );
          })}

          {/* Outstanding planned additions (faded/dashed) */}
          {outstandingPlanned.map((planned) => {
            const config =
              ADDITION_TYPE_CONFIG[planned.type] ?? ADDITION_TYPE_CONFIG.other;
            const Icon = config.icon;
            return (
              <TableRow
                key={`planned-${planned.id}`}
                className="border-dashed opacity-50"
              >
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">{config.label}</span>
                  </div>
                </TableCell>
                <TableCell className="font-medium">
                  {planned.name}
                  <Badge
                    variant="outline"
                    className="ml-2 text-xs font-normal"
                  >
                    Planned
                  </Badge>
                </TableCell>
                <TableCell>
                  {Number(planned.amount)} {planned.unit}
                </TableCell>
                <TableCell>{formatTiming(planned.timing, null)}</TableCell>
                <TableCell>—</TableCell>
                <TableCell>—</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <div className="flex justify-end border-t pt-3">
        <Button variant="outline" size="sm" asChild>
          <Link href={`/production/batches/${batchId}/additions`}>
            <Plus className="mr-1 h-4 w-4" />
            Add Addition
          </Link>
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTiming(timing: string | null, days: number | null): string {
  if (!timing && days == null) return "—";
  const parts: string[] = [];
  if (timing) {
    parts.push(timing.replace(/_/g, " "));
  }
  if (days != null) {
    parts.push(`${days}d`);
  }
  return parts.join(" / ");
}
