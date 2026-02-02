"use client";

/**
 * BrewLogTimeline - Wrapper for BrewEventTimeline in EntityDetail
 *
 * This component is used within the EntityDetail view for brew logs.
 * It provides the data fetching and mutation logic for the timeline.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { brewLogKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { Clock } from "lucide-react";
import { BrewEventTimeline } from "./brew-event-timeline";
import type { BrewEvent } from "@/entities/brew-log";
import type { Database } from "@/types/supabase";

type BrewLog = Database["public"]["Tables"]["brew_logs"]["Row"];

interface BrewLogTimelineProps {
  data: BrewLog;
}

export function BrewLogTimeline({ data }: BrewLogTimelineProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  const events = (data.events as BrewEvent[]) || [];
  const isReadOnly = data.status === "completed" || data.status === "cancelled";

  // Mutation for updating events
  const updateEventsMutation = useMutation({
    mutationFn: async (newEvents: BrewEvent[]) => {
      const { error } = await supabase
        .from("brew_logs")
        .update({ events: newEvents })
        .eq("id", data.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: brewLogKeys.detail(data.id) });
    },
  });

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

  // Show compact view if no events
  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-center">
        <Clock className="h-10 w-10 text-muted-foreground/50 mb-3" />
        <p className="text-muted-foreground mb-4">No brew events recorded yet.</p>
        <Button asChild>
          <Link href={`/production/brew-logs/${data.id}/events`}>
            Record Events
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <BrewEventTimeline
        events={events}
        onAddEvent={!isReadOnly ? handleAddEvent : undefined}
        onUpdateEvent={!isReadOnly ? handleUpdateEvent : undefined}
        onDeleteEvent={!isReadOnly ? handleDeleteEvent : undefined}
        readOnly={isReadOnly}
      />
      <div className="flex justify-end">
        <Button variant="outline" size="sm" asChild>
          <Link href={`/production/brew-logs/${data.id}/events`}>
            View Full Timeline
          </Link>
        </Button>
      </div>
    </div>
  );
}
