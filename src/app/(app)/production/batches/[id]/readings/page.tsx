"use client";

/**
 * Batch Readings Page
 *
 * Mobile-optimized page for viewing and recording fermentation readings.
 * Features:
 * - Quick add reading form with "Save & Add Another" for multi-metric
 *   cellar rounds (form stays open between saves)
 * - Per-row edit (dialog) and delete (confirm) for mis-entered readings
 * - History and latest-by-type ordered by the user-entered reading
 *   timestamp (falls back to created_at), so backdated readings land in
 *   the right place
 * - Real-time updates
 */

import { use, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { BatchReadingForm } from "@/components/domain/batch/batch-reading-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import {
  type BatchReading,
  type ReadingType,
  READING_TYPES,
  formatReadingValue,
} from "@/domain/batch-readings";
import {
  readingLogTime,
  sortReadingLogsByTimestampDesc,
} from "@/domain/batch-reading-log";
import { BatchReadingsChartLazy as BatchReadingsChart } from "@/components/domain/batch/batch-readings-chart-lazy";
import { format } from "date-fns";
import type { Json } from "@/types/supabase";
import { useGravityUnit, useTemperatureUnit } from "@/hooks/use-unit-preferences";
import { batchKeys } from "@/lib/query-keys";
import { parseUnknownError } from "@/lib/errors";
import { usePrefillStore } from "@/contexts/prefill-store";

type BatchLog = {
  id: string;
  batch_id: string;
  log_type: string;
  data: BatchReading;
  created_at: string;
  created_by: string | null;
}

export default function BatchReadingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const supabase = createClient();
  const queryClient = useQueryClient();
  const gravityUnit = useGravityUnit();
  const temperatureUnit = useTemperatureUnit();
  const displayUnitFor = (readingType: string) =>
    readingType === "gravity"
      ? gravityUnit
      : readingType === "temperature"
        ? temperatureUnit
        : undefined;

  // Consume prefill store once on initial render to auto-show form from AI
  const [showForm, setShowForm] = useState(() => {
    const { prefillData } = usePrefillStore.getState().consume();
    return !!prefillData;
  });
  const [editingLog, setEditingLog] = useState<BatchLog | null>(null);
  const [deletingLogId, setDeletingLogId] = useState<string | null>(null);

  // Fetch batch details
  const { data: batch, isLoading: batchLoading } = useQuery({
    queryKey: batchKeys.detail(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("batches")
        .select("id, batch_code, name, status, recipe_id")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Fetch readings from batch_logs
  const { data: readings, isLoading: readingsLoading } = useQuery({
    queryKey: batchKeys.readings(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("batch_logs")
        .select("*")
        .eq("batch_id", id)
        .eq("log_type", "measurement")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as unknown) as BatchLog[];
    },
  });

  // Re-sort newest-first by the user-entered reading timestamp (falling back
  // to created_at) so backdated readings appear in the right place.
  const sortedReadings = useMemo(
    () => (readings ? sortReadingLogsByTimestampDesc(readings) : undefined),
    [readings]
  );

  // Add reading mutation. The form decides whether to stay open ("Save &
  // Add Another") or close (plain save, via onSaved) — don't close it here.
  const addReading = useMutation({
    mutationFn: async (reading: BatchReading) => {
      const { data, error } = await supabase
        .from("batch_logs")
        .insert({
          batch_id: id,
          log_type: "measurement",
          data: reading as unknown as Json,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: batchKeys.readings(id) });
      toast.success("Reading saved");
    },
    onError: (error) => {
      toast.error("Failed to save reading: " + parseUnknownError(error).message);
    },
  });

  // Update an existing reading's data payload in place
  const updateReading = useMutation({
    mutationFn: async ({
      logId,
      reading,
    }: {
      logId: string;
      reading: BatchReading;
    }) => {
      const { error } = await supabase
        .from("batch_logs")
        .update({ data: reading as unknown as Json })
        .eq("id", logId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: batchKeys.readings(id) });
      toast.success("Reading updated");
    },
    onError: (error) => {
      toast.error("Failed to update reading: " + parseUnknownError(error).message);
    },
  });

  // Delete a mis-entered reading (confirmed via AlertDialog)
  const deleteReading = useMutation({
    mutationFn: async (logId: string) => {
      const { error } = await supabase
        .from("batch_logs")
        .delete()
        .eq("id", logId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: batchKeys.readings(id) });
      setDeletingLogId(null);
      toast.success("Reading deleted");
    },
    onError: (error) => {
      toast.error("Failed to delete reading: " + parseUnknownError(error).message);
    },
  });

  // Group readings by type for summary
  const readingsByType = sortedReadings?.reduce(
    (acc, log) => {
      const type = log.data.reading_type;
      if (!acc[type]) acc[type] = [];
      acc[type].push(log);
      return acc;
    },
    {} as Record<ReadingType, BatchLog[]>
  );

  // Get latest reading for each type
  const latestByType = readingsByType
    ? (Object.entries(readingsByType) as [ReadingType, BatchLog[]][]).reduce(
        (acc, [type, logs]) => {
          acc[type] = logs[0]; // Already sorted DESC by effective timestamp
          return acc;
        },
        {} as Record<ReadingType, BatchLog>
      )
    : {};

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
          <p className="text-muted-foreground">Fermentation Readings</p>
        </div>
        {!showForm && (
          <Button size="lg" onClick={() => setShowForm(true)}>
            <Plus className="h-5 w-5 mr-2" />
            Add Reading
          </Button>
        )}
      </div>

      {/* Quick Add Form */}
      {showForm && (
        <BatchReadingForm
          batchId={id}
          onSubmit={async (data) => { await addReading.mutateAsync(data); }}
          onSaved={() => setShowForm(false)}
          onCancel={() => setShowForm(false)}
          isSubmitting={addReading.isPending}
        />
      )}

      {/* Latest Readings Summary */}
      {Object.keys(latestByType).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Current Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {(Object.entries(latestByType) as [ReadingType, BatchLog][]).map(
                ([type, log]) => {
                  const config = READING_TYPES[type];
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
                          {formatReadingValue(type, log.data.value, log.data.unit, displayUnitFor(type))}
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

      {/* Fermentation Chart */}
      {sortedReadings && sortedReadings.length > 0 && (
        <BatchReadingsChart readings={sortedReadings} />
      )}

      {/* Readings History */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">History</CardTitle>
        </CardHeader>
        <CardContent>
          {readingsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : !sortedReadings || sortedReadings.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No readings recorded yet. Add your first reading above.
            </p>
          ) : (
            <div className="space-y-3">
              {sortedReadings.map((log) => {
                const config = READING_TYPES[log.data.reading_type];
                const effectiveTime = readingLogTime(log);
                return (
                  <div
                    key={log.id}
                    className="flex items-center gap-4 rounded-lg border p-4"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="font-medium">{config.label}</span>
                        <span className="text-lg font-semibold">
                          {formatReadingValue(
                            log.data.reading_type,
                            log.data.value,
                            log.data.unit,
                            displayUnitFor(log.data.reading_type)
                          )}
                        </span>
                      </div>
                      {log.data.notes && (
                        <p className="text-sm text-muted-foreground truncate">
                          {log.data.notes}
                        </p>
                      )}
                    </div>
                    <div className="text-right text-sm text-muted-foreground flex-shrink-0">
                      <p>{format(effectiveTime, "MMM d")}</p>
                      <p>{format(effectiveTime, "h:mm a")}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9"
                        aria-label="Edit reading"
                        onClick={() => setEditingLog(log)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-muted-foreground hover:text-destructive"
                        aria-label="Delete reading"
                        onClick={() => setDeletingLogId(log.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Reading Dialog */}
      <Dialog
        open={!!editingLog}
        onOpenChange={(open) => {
          if (!open) setEditingLog(null);
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Reading</DialogTitle>
          </DialogHeader>
          {editingLog && (
            <BatchReadingForm
              batchId={id}
              embedded
              initialData={editingLog.data}
              onSubmit={async (reading) => {
                await updateReading.mutateAsync({ logId: editingLog.id, reading });
              }}
              onSaved={() => setEditingLog(null)}
              onCancel={() => setEditingLog(null)}
              isSubmitting={updateReading.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deletingLogId}
        onOpenChange={(open) => {
          if (!open) setDeletingLogId(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete reading?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this reading from the batch history.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="outline" disabled={deleteReading.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deletingLogId) deleteReading.mutate(deletingLogId);
              }}
              disabled={deleteReading.isPending}
            >
              {deleteReading.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </ErrorBoundary>
  );
}
