"use client";

/**
 * BrewLogTimeline - Wrapper for BrewEventTimeline in EntityDetail
 *
 * This component is used within the EntityDetail view for brew logs.
 * It provides the data fetching and mutation logic for the timeline.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { brewLogKeys, entityKeys } from "@/lib/query-keys";
import { BrewEventTimeline } from "./brew-event-timeline";
import type { BrewEvent } from "@/entities/brew-log";
import type { Database } from "@/types/supabase";

type BrewLog = Database["public"]["Tables"]["brew_logs"]["Row"];

type BrewLogTimelineProps = {
  data: BrewLog;
  /** Action trigger from headerActions via UnifiedSectionCard */
  actionTrigger?: { action: string; seq: number } | null;
}

export function BrewLogTimeline({ data, actionTrigger }: BrewLogTimelineProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  const events = (data.events as BrewEvent[]) || [];
  const isReadOnly = data.status === "completed" || data.status === "cancelled";

  // The entity detail view table (may be viewTable or base table)
  const viewTable = "brew_logs_with_batches";
  const baseTable = "brew_logs";

  /**
   * Optimistically update the brew log's events in all relevant query caches.
   * Returns a rollback function in case the mutation fails.
   */
  function optimisticUpdate(newEvents: BrewEvent[]) {
    const patchEvents = (old: unknown) => {
      if (!old || typeof old !== "object") return old;
      return { ...(old as Record<string, unknown>), events: newEvents };
    };

    // Snapshot previous values for rollback
    const prevView = queryClient.getQueryData(entityKeys.detail(viewTable, data.id));
    const prevBase = queryClient.getQueryData(entityKeys.detail(baseTable, data.id));
    const prevBrewLog = queryClient.getQueryData(brewLogKeys.detail(data.id));

    queryClient.setQueryData(entityKeys.detail(viewTable, data.id), patchEvents);
    queryClient.setQueryData(entityKeys.detail(baseTable, data.id), patchEvents);
    queryClient.setQueryData(brewLogKeys.detail(data.id), patchEvents);

    return () => {
      queryClient.setQueryData(entityKeys.detail(viewTable, data.id), prevView);
      queryClient.setQueryData(entityKeys.detail(baseTable, data.id), prevBase);
      queryClient.setQueryData(brewLogKeys.detail(data.id), prevBrewLog);
    };
  }

  // Mutation for updating events with optimistic updates
  const updateEventsMutation = useMutation({
    mutationFn: async (newEvents: BrewEvent[]) => {
      const { error } = await supabase
        .from("brew_logs")
        .update({ events: newEvents })
        .eq("id", data.id);

      if (error) throw error;
    },
    onSuccess: () => {
      // Refetch to ensure server state is canonical
      queryClient.invalidateQueries({ queryKey: brewLogKeys.detail(data.id) });
      queryClient.invalidateQueries({ queryKey: entityKeys.detail(viewTable, data.id) });
      queryClient.invalidateQueries({ queryKey: entityKeys.detail(baseTable, data.id) });
    },
  });

  const handleAddEvent = async (event: BrewEvent) => {
    const newEvents = [...events, event];
    const rollback = optimisticUpdate(newEvents);
    try {
      await updateEventsMutation.mutateAsync(newEvents);
    } catch {
      rollback();
      toast.error("Failed to add event");
    }
  };

  const handleUpdateEvent = async (updatedEvent: BrewEvent) => {
    const newEvents = events.map((e) =>
      e.id === updatedEvent.id ? updatedEvent : e
    );
    const rollback = optimisticUpdate(newEvents);
    try {
      await updateEventsMutation.mutateAsync(newEvents);
    } catch {
      rollback();
      toast.error("Failed to update event");
    }
  };

  const handleDeleteEvent = async (eventId: string) => {
    const newEvents = events.filter((e) => e.id !== eventId);
    const rollback = optimisticUpdate(newEvents);
    try {
      await updateEventsMutation.mutateAsync(newEvents);
    } catch {
      rollback();
      toast.error("Failed to delete event");
    }
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
