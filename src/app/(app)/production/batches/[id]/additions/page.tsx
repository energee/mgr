"use client";

/**
 * Batch Additions Page
 *
 * Track additions during fermentation (dry hops, fruit, adjuncts, finings).
 * Features:
 * - Quick add form with catalog search
 * - Chronological additions history
 * - Recipe comparison (planned vs actual)
 */

import { use, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { BatchAdditionForm } from "@/components/domain/batch/batch-addition-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { ArrowLeft, Plus } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import {
  type BatchAddition,
  type AdditionType,
  ADDITION_TYPES,
} from "@/domain/batch-additions";
import { PlannedAdditions } from "@/components/domain/batch/planned-additions";
import { format } from "date-fns";
import { batchKeys, batchAdditionKeys } from "@/lib/query-keys";
import { unwrap } from "@/lib/supabase/query-helpers";

/** Row from the batch_additions table */
type BatchAdditionRow = {
  id: string;
  batch_id: string;
  addition_type: string;
  catalog_id: string | null;
  catalog_table: string | null;
  name: string;
  amount: number;
  unit: string;
  timing: string | null;
  days: number | null;
  date_added: string | null;
  notes: string | null;
  created_at: string;
}

/**
 * Map the form's addition_type to the DB enum values.
 * Form uses: dry_hop, fruit, adjunct, fining, spice, other
 * DB allows: hop, adjunct, fruit, spice, yeast, other
 */
function mapAdditionTypeToDb(
  formType: AdditionType
): "hop" | "adjunct" | "fruit" | "spice" | "yeast" | "other" {
  switch (formType) {
    case "dry_hop":
      return "hop";
    case "fruit":
      return "fruit";
    case "adjunct":
      return "adjunct";
    case "fining":
      return "other";
    case "spice":
      return "spice";
    case "other":
      return "other";
  }
}

/**
 * Reverse-map the DB addition_type back to the form AdditionType for display.
 */
function mapDbTypeToDisplay(
  dbType: string
): AdditionType {
  switch (dbType) {
    case "hop":
      return "dry_hop";
    case "fruit":
      return "fruit";
    case "adjunct":
      return "adjunct";
    case "spice":
      return "spice";
    default:
      return "other";
  }
}

/**
 * Map the form's addition_type to the catalog table name for the DB.
 */
function mapTypeToCatalogTable(formType: AdditionType): string | null {
  const config = ADDITION_TYPES[formType];
  return config.catalogTable ?? null;
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

  // Fetch batch details
  const { data: batch, isLoading: batchLoading } = useQuery({
    queryKey: batchKeys.detail(id),
    queryFn: async () => {
      return await unwrap(
        supabase
          .from("batches")
          .select("id, batch_code, name, status, recipe_id")
          .eq("id", id)
          .single()
      ) as unknown as { id: string; batch_code: string; name: string; status: string; recipe_id: string | null };
    },
  });

  // Fetch additions from batch_additions table
  const { data: additions, isLoading: additionsLoading } = useQuery({
    queryKey: batchAdditionKeys.byBatch(id),
    queryFn: async () => {
      return await unwrap(
        supabase
          .from("batch_additions")
          .select("*")
          .eq("batch_id", id)
          .order("created_at", { ascending: false })
      ) as BatchAdditionRow[];
    },
  });

  // Add addition mutation - inserts into batch_additions table
  const addAddition = useMutation({
    mutationFn: async (addition: BatchAddition) => {
      const dbAdditionType = mapAdditionTypeToDb(addition.addition_type);
      const catalogTable = mapTypeToCatalogTable(addition.addition_type);
      const dateAdded = addition.timestamp
        ? new Date(addition.timestamp).toISOString().split("T")[0]
        : null;

      return await unwrap(
        supabase
          .from("batch_additions")
          .insert({
            batch_id: id,
            addition_type: dbAdditionType,
            catalog_id: addition.ingredient_id || null,
            catalog_table: addition.ingredient_id ? catalogTable : null,
            name: addition.ingredient_name,
            amount: addition.quantity,
            unit: addition.unit,
            timing: addition.addition_type === "dry_hop" ? "dry_hop" : null,
            days: addition.contact_time_hours
              ? Math.ceil(addition.contact_time_hours / 24)
              : null,
            date_added: dateAdded,
            notes: addition.notes || null,
          })
          .select()
          .single()
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: batchAdditionKeys.byBatch(id),
      });
      setShowForm(false);
      toast.success("Addition recorded");
    },
    onError: (error) => {
      toast.error("Failed to save: " + error.message);
    },
  });

  // Group additions by display type for summary
  const additionsByType = additions?.reduce(
    (acc, row) => {
      const type = mapDbTypeToDisplay(row.addition_type);
      if (!acc[type]) acc[type] = [];
      acc[type].push(row);
      return acc;
    },
    {} as Record<AdditionType, BatchAdditionRow[]>
  );

  if (batchLoading) {
    return (
      <div className="container max-w-2xl py-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="container max-w-2xl py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href={`/production/batches/${id}`}>
          <Button variant="ghost" size="icon" aria-label="Back to batch">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{batch?.name || batch?.batch_code}</h1>
          <p className="text-muted-foreground">Fermentation Additions</p>
        </div>
        {!showForm && (
          <Button size="lg" onClick={() => setShowForm(true)}>
            <Plus className="h-5 w-5 mr-2" />
            Add
          </Button>
        )}
      </div>

      {/* Quick Add Form */}
      {showForm && (
        <BatchAdditionForm
          batchId={id}
          onSubmit={async (data) => { await addAddition.mutateAsync(data); }}
          onCancel={() => setShowForm(false)}
          isSubmitting={addAddition.isPending}
        />
      )}

      {/* Additions Summary by Type */}
      {additionsByType && Object.keys(additionsByType).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {(Object.entries(additionsByType) as [AdditionType, BatchAdditionRow[]][]).map(
                ([type, rows]) => {
                  const config = ADDITION_TYPES[type];
                  const totalQty = rows.reduce((sum, row) => sum + Number(row.amount), 0);
                  const unit = rows[0]?.unit || config.defaultUnit;
                  return (
                    <div
                      key={type}
                      className="flex items-center gap-3 rounded-lg border p-3"
                    >
                      <div>
                        <p className="text-sm text-muted-foreground">
                          {config.label}
                        </p>
                        <p className="text-lg font-semibold">
                          {totalQty.toFixed(1)} {unit}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {rows.length} addition{rows.length !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Planned Additions from Recipe */}
      {batch?.recipe_id && additions && (
        <PlannedAdditions
          recipeId={batch.recipe_id}
          actualAdditions={additions}
        />
      )}

      {/* Additions History */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">History</CardTitle>
        </CardHeader>
        <CardContent>
          {additionsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : !additions || additions.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No additions recorded yet. Add your first addition above.
            </p>
          ) : (
            <div className="space-y-3">
              {additions?.map((row) => {
                const displayType = mapDbTypeToDisplay(row.addition_type);
                const config = ADDITION_TYPES[displayType];
                return (
                  <div
                    key={row.id}
                    className="flex items-start gap-4 rounded-lg border p-4"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="font-medium">{row.name}</span>
                        <span className="text-muted-foreground">
                          {Number(row.amount)} {row.unit}
                        </span>
                        <span className="text-xs bg-muted px-2 py-0.5 rounded">
                          {config.label}
                        </span>
                      </div>
                      {row.days != null && row.days > 0 && (
                        <p className="text-sm text-muted-foreground">
                          Contact time: {row.days} day{row.days !== 1 ? "s" : ""}
                        </p>
                      )}
                      {row.notes && (
                        <p className="text-sm text-muted-foreground truncate">
                          {row.notes}
                        </p>
                      )}
                    </div>
                    <div className="text-right text-sm text-muted-foreground flex-shrink-0">
                      <p>{format(new Date(row.created_at), "MMM d")}</p>
                      <p>{format(new Date(row.created_at), "h:mm a")}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
    </ErrorBoundary>
  );
}
