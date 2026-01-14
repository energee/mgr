"use client";

/**
 * Batch Readings Page
 *
 * Mobile-optimized page for viewing and recording fermentation readings.
 * Features:
 * - Quick add reading form
 * - Chronological readings list
 * - Real-time updates
 */

import { use, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { BatchReadingForm } from "@/components/domain/batch-reading-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { ArrowLeft, Plus, Thermometer, Droplets, Beaker } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import {
  type BatchReading,
  type ReadingType,
  READING_TYPES,
  formatReadingValue,
} from "@/lib/batch-readings";
import { BatchReadingsChart } from "@/components/domain/batch-readings-chart";
import { format } from "date-fns";
import type { Json } from "@/types/supabase";

interface BatchLog {
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
  const [showForm, setShowForm] = useState(false);

  // Fetch batch details
  const { data: batch, isLoading: batchLoading } = useQuery({
    queryKey: ["batch", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("batches")
        .select("id, batch_number, name, status, recipe_id")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Fetch readings from batch_logs
  const { data: readings, isLoading: readingsLoading } = useQuery({
    queryKey: ["batch-readings", id],
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

  // Add reading mutation
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
      queryClient.invalidateQueries({ queryKey: ["batch-readings", id] });
      setShowForm(false);
      toast.success("Reading saved");
    },
    onError: (error) => {
      toast.error("Failed to save reading: " + error.message);
    },
  });

  // Group readings by type for summary
  const readingsByType = readings?.reduce(
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
          acc[type] = logs[0]; // Already sorted DESC
          return acc;
        },
        {} as Record<ReadingType, BatchLog>
      )
    : {};

  const getReadingIcon = (type: ReadingType) => {
    switch (type) {
      case "temperature":
        return Thermometer;
      case "gravity":
        return Droplets;
      default:
        return Beaker;
    }
  };

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
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{batch?.name || batch?.batch_number}</h1>
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
                  const Icon = getReadingIcon(type);
                  const config = READING_TYPES[type];
                  return (
                    <div
                      key={type}
                      className="flex items-center gap-3 rounded-lg border p-3"
                    >
                      <Icon className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="text-sm text-muted-foreground">
                          {config.label}
                        </p>
                        <p className="text-lg font-semibold">
                          {formatReadingValue(type, log.data.value, log.data.unit)}
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
      {readings && readings.length > 0 && (
        <BatchReadingsChart readings={readings} />
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
          ) : !readings || readings.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No readings recorded yet. Add your first reading above.
            </p>
          ) : (
            <div className="space-y-3">
              {readings?.map((log) => {
                const config = READING_TYPES[log.data.reading_type];
                const Icon = getReadingIcon(log.data.reading_type);
                return (
                  <div
                    key={log.id}
                    className="flex items-center gap-4 rounded-lg border p-4"
                  >
                    <Icon className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="font-medium">{config.label}</span>
                        <span className="text-lg font-semibold">
                          {formatReadingValue(
                            log.data.reading_type,
                            log.data.value,
                            log.data.unit
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
                      <p>{format(new Date(log.created_at), "MMM d")}</p>
                      <p>{format(new Date(log.created_at), "h:mm a")}</p>
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
