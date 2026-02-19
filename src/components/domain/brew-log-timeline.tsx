"use client";

/**
 * BrewLogTimeline - Wrapper for BrewEventTimeline in EntityDetail
 *
 * This component is used within the EntityDetail view for brew logs.
 * It provides the data fetching and mutation logic for the timeline.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { brewLogKeys } from "@/lib/query-keys";
import { BrewEventTimeline } from "./brew-event-timeline";
import type { BrewEvent } from "@/entities/brew-log";
import type { Database } from "@/types/supabase";

type BrewLog = Database["public"]["Tables"]["brew_logs"]["Row"];

interface BrewLogTimelineProps {
  data: BrewLog;
  /** Action string from headerActions via UnifiedSectionCard */
  actionTrigger?: string | null;
}

export function BrewLogTimeline({ data, actionTrigger }: BrewLogTimelineProps) {
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

  return (
    <div className="space-y-4">
      {isReadOnly && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            This brew log is {data.status}. Events are read-only.
          </p>
        </div>
      )}
      <BrewEventTimeline
        events={events}
        onAddEvent={!isReadOnly ? handleAddEvent : undefined}
        onUpdateEvent={!isReadOnly ? handleUpdateEvent : undefined}
        onDeleteEvent={!isReadOnly ? handleDeleteEvent : undefined}
        readOnly={isReadOnly}
        actionTrigger={actionTrigger}
      />
    </div>
  );
}
