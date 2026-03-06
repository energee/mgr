"use client";

/**
 * BrewEventTimeline - Visual Timeline of Brew Day Events
 *
 * Displays brew events in chronological order with:
 * - Visual timeline with phase grouping
 * - Expandable event details
 * - Measurement display with units
 * - Edit/delete capabilities
 */

import { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
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
import {
  Clock,
  Droplet,
  Flame,
  Thermometer,
  Plus,
  Pencil,
  Trash2,
  FlaskConical,
  Leaf,
  RotateCw,
  ArrowRight,
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { UnitDisplay } from "@/components/ui/unit-input";
import type { BrewEvent } from "@/entities/brew-log";
import { useBrewPhases, useBrewMetrics } from "@/hooks/use-brew-enums";
import { BrewEventForm } from "./brew-event-form";

// =============================================================================
// Icon Mapping
// =============================================================================

/** Convert "HH:MM" (24hr) to "h:MM AM/PM" */
function formatTime12(time: string): string {
  const [hStr, mStr] = time.split(":");
  let h = parseInt(hStr, 10);
  const suffix = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${mStr} ${suffix}`;
}

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  droplet: Droplet,
  grain: FlaskConical,
  clock: Clock,
  thermometer: Thermometer,
  refresh: RotateCw,
  "arrow-down": ArrowRight,
  check: ArrowRight,
  container: FlaskConical,
  flame: Flame,
  leaf: Leaf,
  plus: Plus,
  "arrow-right": ArrowRight,
  flask: FlaskConical,
  sliders: MoreHorizontal,
  "more-horizontal": MoreHorizontal,
};

// =============================================================================
// Phase Colors
// =============================================================================

const phaseColors: Record<string, string> = {
  strike_water: "bg-blue-100 border-blue-300 dark:bg-blue-950 dark:border-blue-700",
  mash_in: "bg-amber-100 border-amber-300 dark:bg-amber-950 dark:border-amber-700",
  mash_rest: "bg-amber-50 border-amber-200 dark:bg-amber-900 dark:border-amber-600",
  mash_step: "bg-amber-100 border-amber-300 dark:bg-amber-950 dark:border-amber-700",
  vorlauf: "bg-yellow-100 border-yellow-300 dark:bg-yellow-950 dark:border-yellow-700",
  runoff_start: "bg-yellow-50 border-yellow-200 dark:bg-yellow-900 dark:border-yellow-600",
  runoff_end: "bg-yellow-100 border-yellow-300 dark:bg-yellow-950 dark:border-yellow-700",
  sparge_start: "bg-cyan-100 border-cyan-300 dark:bg-cyan-950 dark:border-cyan-700",
  sparge_end: "bg-cyan-50 border-cyan-200 dark:bg-cyan-900 dark:border-cyan-600",
  kettle_full: "bg-orange-100 border-orange-300 dark:bg-orange-950 dark:border-orange-700",
  boil_start: "bg-red-100 border-red-300 dark:bg-red-950 dark:border-red-700",
  boil_end: "bg-red-50 border-red-200 dark:bg-red-900 dark:border-red-600",
  hop_addition: "bg-green-100 border-green-300 dark:bg-green-950 dark:border-green-700",
  adjunct_addition: "bg-purple-100 border-purple-300 dark:bg-purple-950 dark:border-purple-700",
  whirlpool_start: "bg-indigo-100 border-indigo-300 dark:bg-indigo-950 dark:border-indigo-700",
  whirlpool_rest: "bg-indigo-50 border-indigo-200 dark:bg-indigo-900 dark:border-indigo-600",
  whirlpool_end: "bg-indigo-100 border-indigo-300 dark:bg-indigo-950 dark:border-indigo-700",
  ko_start: "bg-teal-100 border-teal-300 dark:bg-teal-950 dark:border-teal-700",
  ko_end: "bg-teal-50 border-teal-200 dark:bg-teal-900 dark:border-teal-600",
  yeast_pitch: "bg-lime-100 border-lime-300 dark:bg-lime-950 dark:border-lime-700",
  hourly_check: "bg-gray-100 border-gray-300 dark:bg-gray-800 dark:border-gray-600",
  flow_rate_change: "bg-gray-50 border-gray-200 dark:bg-gray-900 dark:border-gray-700",
  other: "bg-slate-100 border-slate-300 dark:bg-slate-800 dark:border-slate-600",
};

// =============================================================================
// Types
// =============================================================================

interface BrewEventTimelineProps {
  events: BrewEvent[];
  onAddEvent?: (event: BrewEvent) => Promise<void>;
  onUpdateEvent?: (event: BrewEvent) => Promise<void>;
  onDeleteEvent?: (eventId: string) => Promise<void>;
  readOnly?: boolean;
  isLoading?: boolean;
  /** Action trigger from headerActions via UnifiedSectionCard */
  actionTrigger?: { action: string; seq: number } | null;
}

// =============================================================================
// Header Actions (rendered by the unified section card next to the title)
// =============================================================================

/** Header action button for adding brew events, used via section headerActions */
export function BrewEventTimelineActions({
  data,
  onAction,
}: {
  data: Record<string, unknown>;
  onAction: (action: string) => void;
}) {
  const isReadOnly = data.status === "completed" || data.status === "cancelled";
  if (isReadOnly) return null;

  return (
    <Button
      size="sm"
      onClick={() => onAction("add-event")}
      className="h-9"
    >
      <Plus className="mr-1 h-4 w-4" />
      Add Event
    </Button>
  );
}

// =============================================================================
// Component
// =============================================================================

export function BrewEventTimeline({
  events,
  onAddEvent,
  onUpdateEvent,
  onDeleteEvent,
  readOnly = false,
  isLoading = false,
  actionTrigger,
}: BrewEventTimelineProps) {
  const { data: phaseData } = useBrewPhases();
  const { data: metricData } = useBrewMetrics();

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState<BrewEvent | null>(null);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Handle action triggers from headerActions via UnifiedSectionCard
  useEffect(() => {
    if (actionTrigger?.action === "add-event") {
      setShowAddForm(true);
    }
  }, [actionTrigger]);

  // Sort events by time
  const sortedEvents = useMemo(() => {
    return [...events].sort((a, b) => {
      if (!a.time || !b.time) return 0;
      return a.time.localeCompare(b.time);
    });
  }, [events]);

  const handleAddEvent = async (event: BrewEvent) => {
    if (!onAddEvent) return;
    setIsSubmitting(true);
    try {
      await onAddEvent(event);
      setShowAddForm(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateEvent = async (event: BrewEvent) => {
    if (!onUpdateEvent) return;
    setIsSubmitting(true);
    try {
      await onUpdateEvent(event);
      setEditingEvent(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteEvent = async () => {
    if (!onDeleteEvent || !deletingEventId) return;
    setIsSubmitting(true);
    try {
      await onDeleteEvent(deletingEventId);
      setDeletingEventId(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  function getPhaseIcon(phase: string): React.ComponentType<{ className?: string }> {
    const phaseEntry = phaseData?.phases.find((p) => p.value === phase);
    const iconName = phaseEntry?.icon || "more-horizontal";
    return iconMap[iconName] || MoreHorizontal;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-pulse text-muted-foreground">Loading events...</div>
      </div>
    );
  }

  return (
    <>
      <div>
        {sortedEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Clock className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground">No events recorded yet.</p>
            {!readOnly && onAddEvent && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAddForm(true)}
                className="mt-4"
              >
                <Plus className="mr-1 h-4 w-4" />
                Record First Event
              </Button>
            )}
          </div>
        ) : (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />

            {/* Events */}
            <div className="space-y-4">
              {sortedEvents.map((event, index) => {
                const eventId = event.id || `event-${index}`;
                const PhaseIcon = getPhaseIcon(event.phase);
                const phaseLabelMap = phaseData?.labelMap ?? new Map<string, string>();
                const phaseLabel =
                  event.phase === "other"
                    ? (event.custom_phase || "Other")
                    : (phaseLabelMap.get(event.phase) || event.phase);
                const colorClass = phaseColors[event.phase] || phaseColors.other;

                  return (
                    <div key={eventId} className="relative pl-10">
                      {/* Timeline dot */}
                      <div
                        className={cn(
                          "absolute left-2 top-2.5 h-5 w-5 rounded-full border-2 flex items-center justify-center",
                          colorClass
                        )}
                      >
                        <PhaseIcon className="h-3 w-3" />
                      </div>

                      {/* Event row */}
                      <div
                        className={cn(
                          "rounded-lg border px-3 py-2 transition-colors",
                          colorClass
                        )}
                      >
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="font-mono text-sm text-muted-foreground shrink-0">
                            {formatTime12(event.time)}
                          </span>
                          <span className="font-medium shrink-0">{phaseLabel}</span>

                          {/* Inline measurements */}
                          {event.measurements && event.measurements.length > 0 && (
                            <>
                              <span className="text-muted-foreground/40">|</span>
                              {event.measurements.map((m, mIndex) => {
                                const metricConfigMap = metricData?.configMap ?? new Map();
                                const config = metricConfigMap.get(m.metric);
                                const unitType = config?.unitType;
                                const decimals = config?.decimals ?? 2;
                                const label = m.metric === "other"
                                  ? m.custom_metric || "Other"
                                  : config?.label || m.metric;

                                return (
                                  <span
                                    key={mIndex}
                                    className="inline-flex items-center gap-1 text-sm"
                                  >
                                    <span className="font-medium">
                                      {unitType && typeof m.value === "number" ? (
                                        <UnitDisplay
                                          value={m.value}
                                          unitType={unitType}
                                          decimals={decimals}
                                        />
                                      ) : (
                                        <>
                                          {m.value}
                                          {config?.unit ? ` ${config.unit}` : ""}
                                        </>
                                      )}
                                    </span>
                                    <span className="text-xs text-muted-foreground">{label}</span>
                                  </span>
                                );
                              })}
                            </>
                          )}

                          {/* Inline notes */}
                          {event.notes && (
                            <>
                              <span className="text-muted-foreground/40">|</span>
                              <span className="text-sm text-muted-foreground truncate">{event.notes}</span>
                            </>
                          )}

                          {/* Spacer + actions */}
                          {!readOnly && (
                            <div className="ml-auto flex items-center gap-1 shrink-0">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                aria-label="Edit event"
                                onClick={() => setEditingEvent(event)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                aria-label="Delete event"
                                onClick={() => setDeletingEventId(eventId)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

      {/* Add Event Dialog */}
      <Dialog open={showAddForm} onOpenChange={setShowAddForm}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Brew Event</DialogTitle>
          </DialogHeader>
          <BrewEventForm
            onSubmit={handleAddEvent}
            onCancel={() => setShowAddForm(false)}
            isSubmitting={isSubmitting}
          />
        </DialogContent>
      </Dialog>

      {/* Edit Event Dialog */}
      <Dialog open={!!editingEvent} onOpenChange={() => setEditingEvent(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Brew Event</DialogTitle>
          </DialogHeader>
          {editingEvent && (
            <BrewEventForm
              onSubmit={handleUpdateEvent}
              onCancel={() => setEditingEvent(null)}
              isSubmitting={isSubmitting}
              initialData={editingEvent}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deletingEventId} onOpenChange={() => setDeletingEventId(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete event?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this brew event. This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="outline" disabled={isSubmitting}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDeleteEvent}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
