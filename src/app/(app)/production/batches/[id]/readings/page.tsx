"use client";

/**
 * Batch Readings Page
 *
 * Mobile-optimized page for viewing and recording fermentation readings.
 * Features:
 * - Touch-friendly reading entry form
 * - Chronological readings list
 * - Inline editing capability
 */

import { use, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { BatchReadingForm } from "@/components/domain/batch-reading-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, ArrowLeft, Thermometer, Droplets, Beaker, Gauge } from "lucide-react";
import Link from "next/link";
import {
  READING_TYPES,
  formatReadingValue,
  type ReadingType,
  type BatchReading,
} from "@/lib/batch-readings";
import { toast } from "sonner";

// Icon mapping for reading types
const readingIcons: Record<ReadingType, React.ElementType> = {
  gravity: Droplets,
  temperature: Thermometer,
  ph: Beaker,
  pressure: Gauge,
  dissolved_oxygen: Droplets,
  diacetyl: Beaker,
  clarity: Droplets,
};

interface BatchLogReading {
  id: string;
  batch_id: string;
  log_type: string;
  data: BatchReading | Record<string, unknown>;
  created_at: string | null;
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
  const { data: batch, isLoading: loadingBatch } = useQuery({
    queryKey: ["batch", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("batches")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Fetch readings from batch_logs
  const { data: readings = [], isLoading: loadingReadings } = useQuery({
    queryKey: ["batch-readings", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("batch_logs")
        .select("*")
        .eq("batch_id", id)
        .eq("log_type", "reading")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as BatchLogReading[];
    },
  });

  // Add reading mutation
  const addReading = useMutation({
    mutationFn: async (reading: BatchReading) => {
      // Cast to Json type that supabase expects
      const { error } = await supabase.from("batch_logs").insert({
        batch_id: id,
        log_type: "reading",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: reading as any,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["batch-readings", id] });
      setShowForm(false);
      toast.success("Reading saved");
    },
    onError: (error) => {
      toast.error("Failed to save reading", {
        description: error.message,
      });
    },
  });

  // Delete reading mutation
  const deleteReading = useMutation({
    mutationFn: async (readingId: string) => {
      const { error } = await supabase
        .from("batch_logs")
        .delete()
        .eq("id", readingId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["batch-readings", id] });
      toast.success("Reading deleted");
    },
    onError: (error) => {
      toast.error("Failed to delete reading", {
        description: error.message,
      });
    },
  });

  // Group readings by date for display
  const groupedReadings = readings.reduce<Record<string, BatchLogReading[]>>(
    (groups, reading) => {
      const date = reading.created_at
        ? new Date(reading.created_at).toLocaleDateString()
        : "Unknown";
      if (!groups[date]) groups[date] = [];
      groups[date].push(reading);
      return groups;
    },
    {}
  );

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
            {batch?.batch_number} &bull; Fermentation Readings
          </p>
        </div>
        {!showForm && (
          <Button size="lg" onClick={() => setShowForm(true)} className="h-12 gap-2">
            <Plus className="h-5 w-5" />
            <span className="hidden sm:inline">Add Reading</span>
          </Button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <BatchReadingForm
          batchId={id}
          onSubmit={addReading.mutateAsync}
          onCancel={() => setShowForm(false)}
          isSubmitting={addReading.isPending}
        />
      )}

      {/* Readings List */}
      {loadingReadings ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : readings.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Droplets className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No readings yet</h3>
            <p className="text-muted-foreground mb-4">
              Start tracking fermentation by adding your first reading.
            </p>
            <Button onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add First Reading
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedReadings).map(([date, dateReadings]) => (
            <div key={date}>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">
                {date}
              </h3>
              <div className="space-y-3">
                {dateReadings.map((reading) => (
                  <ReadingCard
                    key={reading.id}
                    reading={reading}
                    onDelete={() => {
                      if (confirm("Delete this reading?")) {
                        deleteReading.mutate(reading.id);
                      }
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Reading Card Component
function ReadingCard({
  reading,
  onDelete,
}: {
  reading: BatchLogReading;
  onDelete: () => void;
}) {
  const data = reading.data as BatchReading;
  const type = data.reading_type as ReadingType;
  const config = READING_TYPES[type];
  const Icon = readingIcons[type] || Droplets;

  const time = reading.created_at
    ? new Date(reading.created_at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-4 p-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Icon className="h-6 w-6 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline">{config?.label || type}</Badge>
            <span className="text-sm text-muted-foreground">{time}</span>
          </div>
          <div className="text-2xl font-semibold">
            {formatReadingValue(type, data.value, data.unit)}
          </div>
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
