"use client";

/**
 * Brew Log Events Page
 *
 * Timeline view for recording and viewing brew day events.
 * Mobile-optimized for use on brewery floor.
 */

import { use } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { brewLogKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { BrewEventTimeline } from "@/components/domain/brew-event-timeline";
import type { BrewEvent } from "@/entities/brew-log";

interface BrewLogEventsPageProps {
  params: Promise<{ id: string }>;
}

export default function BrewLogEventsPage({ params }: BrewLogEventsPageProps) {
  const { id } = use(params);
  const supabase = createClient();
  const queryClient = useQueryClient();

  // Fetch brew log with events
  const { data: brewLog, isLoading } = useQuery({
    queryKey: brewLogKeys.detail(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brew_logs")
        .select("*")
        .eq("id", id)
        .single();

      if (error) throw error;
      return data;
    },
  });

  // Mutation for updating events
  const updateEventsMutation = useMutation({
    mutationFn: async (events: BrewEvent[]) => {
      const { error } = await supabase
        .from("brew_logs")
        .update({ events })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: brewLogKeys.detail(id) });
    },
  });

  const events = (brewLog?.events as BrewEvent[]) || [];
  const isReadOnly = brewLog?.status === "completed" || brewLog?.status === "cancelled";

  const handleAddEvent = async (event: BrewEvent) => {
    const newEvents = [...events, event];
    await updateEventsMutation.mutateAsync(newEvents);
  };

  const handleUpdateEvent = async (updatedEvent: BrewEvent) => {
    const newEvents = events.map((e) =>
      e.id === updatedEvent.id ? updatedEvent : e
    );
    await updateEventsMutation.mutateAsync(newEvents);
  };

  const handleDeleteEvent = async (eventId: string) => {
    const newEvents = events.filter((e) => e.id !== eventId);
    await updateEventsMutation.mutateAsync(newEvents);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/production/brew-logs/${id}`}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">
            {brewLog?.brew_number || "Brew Log"} - Events
          </h1>
          <p className="text-muted-foreground">
            Record brew day timeline events and measurements
          </p>
        </div>
      </div>

      {/* Status Warning */}
      {isReadOnly && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            This brew log is {brewLog?.status}. Events are read-only.
          </p>
        </div>
      )}

      {/* Timeline */}
      <BrewEventTimeline
        events={events}
        onAddEvent={!isReadOnly ? handleAddEvent : undefined}
        onUpdateEvent={!isReadOnly ? handleUpdateEvent : undefined}
        onDeleteEvent={!isReadOnly ? handleDeleteEvent : undefined}
        readOnly={isReadOnly}
        isLoading={isLoading}
      />
    </div>
  );
}
