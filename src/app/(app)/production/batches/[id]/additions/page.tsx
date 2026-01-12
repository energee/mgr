"use client";

/**
 * Batch Additions Page
 *
 * Track additions during fermentation (dry hops, fruit, adjuncts, finings).
 * Features:
 * - Touch-friendly addition entry
 * - Comparison to recipe's planned additions
 * - Chronological additions list
 */

import { use, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { BatchAdditionForm } from "@/components/domain/batch-addition-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plus,
  ArrowLeft,
  FlaskConical,
  Leaf,
  Cherry,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ADDITION_TYPES,
  type AdditionType,
  type BatchAddition,
} from "@/lib/batch-additions";

// Icon mapping
const additionIcons: Record<AdditionType, React.ElementType> = {
  dry_hop: Leaf,
  fruit: Cherry,
  adjunct: FlaskConical,
  fining: Sparkles,
  spice: FlaskConical,
  other: FlaskConical,
};

interface BatchLogAddition {
  id: string;
  batch_id: string;
  log_type: string;
  data: BatchAddition | Record<string, unknown>;
  created_at: string | null;
  created_by: string | null;
}

interface PlannedHop {
  id: string;
  hop_id: string;
  weight_oz: number;
  timing: string;
  hop?: {
    id: string;
    name: string;
  };
}

export default function BatchAdditionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  // Fetch batch with recipe
  const { data: batch, isLoading: loadingBatch } = useQuery({
    queryKey: ["batch-with-recipe", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("batches")
        .select("*, recipe:recipes(id, name)")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Fetch additions from batch_logs
  const { data: additions = [], isLoading: loadingAdditions } = useQuery({
    queryKey: ["batch-additions", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("batch_logs")
        .select("*")
        .eq("batch_id", id)
        .eq("log_type", "addition")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as BatchLogAddition[];
    },
  });

  // Fetch planned dry hops from recipe
  const { data: plannedHops = [] } = useQuery({
    queryKey: ["recipe-dry-hops", batch?.recipe?.id],
    queryFn: async () => {
      if (!batch?.recipe?.id) return [];
      const { data, error } = await supabase
        .from("recipe_hops")
        .select("id, hop_id, weight_oz, timing, hop:hops(id, name)")
        .eq("recipe_id", batch.recipe.id)
        .eq("timing", "dry_hop");
      if (error) throw error;
      return (data ?? []) as unknown as PlannedHop[];
    },
    enabled: !!batch?.recipe?.id,
  });

  // Add addition mutation
  const addAddition = useMutation({
    mutationFn: async (addition: BatchAddition) => {
      const { error } = await supabase.from("batch_logs").insert({
        batch_id: id,
        log_type: "addition",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: addition as any,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["batch-additions", id] });
      setShowForm(false);
      toast.success("Addition saved");
    },
    onError: (error) => {
      toast.error("Failed to save addition", { description: error.message });
    },
  });

  // Delete addition mutation
  const deleteAddition = useMutation({
    mutationFn: async (additionId: string) => {
      const { error } = await supabase
        .from("batch_logs")
        .delete()
        .eq("id", additionId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["batch-additions", id] });
      toast.success("Addition deleted");
    },
    onError: (error) => {
      toast.error("Failed to delete", { description: error.message });
    },
  });

  // Calculate variance for dry hops
  const dryHopVariance = (() => {
    const actualDryHops = additions
      .filter((a) => (a.data as BatchAddition).addition_type === "dry_hop")
      .reduce((sum, a) => {
        const data = a.data as BatchAddition;
        // Convert to oz for comparison
        let oz = data.quantity;
        if (data.unit === "lb") oz *= 16;
        if (data.unit === "g") oz *= 0.035274;
        if (data.unit === "kg") oz *= 35.274;
        return sum + oz;
      }, 0);

    const plannedTotal = plannedHops.reduce(
      (sum, h) => sum + (h.weight_oz || 0),
      0
    );

    return {
      actual: actualDryHops,
      planned: plannedTotal,
      variance: actualDryHops - plannedTotal,
    };
  })();

  if (loadingBatch) {
    return (
      <div className="container max-w-2xl py-6">
        <Skeleton className="h-8 w-48 mb-4" />
        <Skeleton className="h-4 w-32 mb-8" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="container max-w-2xl py-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href={`/production/batches/${id}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Batch
          </Link>
          <h1 className="text-2xl font-bold">{batch?.name}</h1>
          <p className="text-muted-foreground">
            {batch?.batch_number} &bull; Additions
          </p>
        </div>
        {!showForm && (
          <Button size="lg" onClick={() => setShowForm(true)} className="h-12 gap-2">
            <Plus className="h-5 w-5" />
            <span className="hidden sm:inline">Add</span>
          </Button>
        )}
      </div>

      {/* Planned Dry Hops (from recipe) */}
      {plannedHops.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              <span>Planned Dry Hops (from Recipe)</span>
              {dryHopVariance.actual > 0 && (
                <Badge
                  variant={
                    Math.abs(dryHopVariance.variance) > dryHopVariance.planned * 0.1
                      ? "destructive"
                      : "default"
                  }
                >
                  {dryHopVariance.actual.toFixed(1)} / {dryHopVariance.planned.toFixed(1)} oz
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {plannedHops.map((hop) => (
                <div
                  key={hop.id}
                  className="flex items-center justify-between text-sm"
                >
                  <span>{hop.hop?.name || "Unknown Hop"}</span>
                  <span className="text-muted-foreground">
                    {hop.weight_oz} oz
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Form */}
      {showForm && (
        <BatchAdditionForm
          batchId={id}
          onSubmit={addAddition.mutateAsync}
          onCancel={() => setShowForm(false)}
          isSubmitting={addAddition.isPending}
        />
      )}

      {/* Additions List */}
      {loadingAdditions ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : additions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FlaskConical className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No additions yet</h3>
            <p className="text-muted-foreground mb-4">
              Record dry hops, fruit, or other additions.
            </p>
            <Button onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add First Addition
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">
            Recorded Additions
          </h3>
          {additions.map((addition) => (
            <AdditionCard
              key={addition.id}
              addition={addition}
              onDelete={() => {
                if (confirm("Delete this addition?")) {
                  deleteAddition.mutate(addition.id);
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Addition Card Component
function AdditionCard({
  addition,
  onDelete,
}: {
  addition: BatchLogAddition;
  onDelete: () => void;
}) {
  const data = addition.data as BatchAddition;
  const type = data.addition_type as AdditionType;
  const config = ADDITION_TYPES[type];
  const Icon = additionIcons[type] || FlaskConical;

  const dateStr = addition.created_at
    ? new Date(addition.created_at).toLocaleDateString()
    : "";
  const timeStr = addition.created_at
    ? new Date(addition.created_at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  return (
    <Card>
      <div className="flex items-center gap-4 p-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Icon className="h-6 w-6 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline">{config?.label || type}</Badge>
            <span className="text-sm text-muted-foreground">
              {dateStr} {timeStr}
            </span>
          </div>
          <div className="text-lg font-semibold">
            {data.quantity} {data.unit} {data.ingredient_name}
          </div>
          {data.contact_time_hours && (
            <p className="text-sm text-muted-foreground">
              {data.contact_time_hours}h contact time
            </p>
          )}
          {data.notes && (
            <p className="text-sm text-muted-foreground mt-1 truncate">
              {data.notes}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="text-muted-foreground hover:text-destructive"
        >
          Delete
        </Button>
      </div>
    </Card>
  );
}
