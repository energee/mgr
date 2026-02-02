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

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
  ChevronDown,
  ChevronRight,
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
import {
  phaseConfig,
  metricConfig,
  type BrewEvent,
  type BrewMeasurement,
} from "@/entities/brew-log";
import { BrewEventForm } from "./brew-event-form";

// =============================================================================
// Icon Mapping
// =============================================================================

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  droplet: Droplet,
  grain: FlaskConical,
  clock: Clock,
  thermometer: Thermometer,
  refresh: RotateCw,
  "arrow-down": ArrowRight,
  check: ChevronRight,
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
}: BrewEventTimelineProps) {
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState<BrewEvent | null>(null);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sort events by time
  const sortedEvents = useMemo(() => {
    return [...events].sort((a, b) => {
      if (!a.time || !b.time) return 0;
      return a.time.localeCompare(b.time);
    });
  }, [events]);

  const toggleExpanded = (eventId: string) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  };

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

  const getPhaseIcon = (phase: string) => {
    const config = phaseConfig[phase as keyof typeof phaseConfig];
    const iconName = config?.icon || "more-horizontal";
    const Icon = iconMap[iconName] || MoreHorizontal;
    return Icon;
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex items-center justify-center">
            <div className="animate-pulse text-muted-foreground">Loading events...</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <CardTitle className="text-lg">Brew Day Timeline</CardTitle>
          {!readOnly && onAddEvent && (
            <Button
              size="sm"
              onClick={() => setShowAddForm(true)}
              className="h-9"
            >
              <Plus className="mr-1 h-4 w-4" />
              Add Event
            </Button>
          )}
        </CardHeader>
        <CardContent>
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
                  const isExpanded = expandedEvents.has(eventId);
                  const PhaseIcon = getPhaseIcon(event.phase);
                  const phaseLabel = event.phase === "other"
                    ? event.custom_phase || "Other"
                    : phaseConfig[event.phase as keyof typeof phaseConfig]?.label || event.phase;
                  const colorClass = phaseColors[event.phase] || phaseColors.other;

                  return (
                    <Collapsible
                      key={eventId}
                      open={isExpanded}
                      onOpenChange={() => toggleExpanded(eventId)}
                    >
                      <div className="relative pl-10">
                        {/* Timeline dot */}
                        <div
                          className={cn(
                            "absolute left-2 top-3 h-5 w-5 rounded-full border-2 flex items-center justify-center",
                            colorClass
                          )}
                        >
                          <PhaseIcon className="h-3 w-3" />
                        </div>

                        {/* Event card */}
                        <div
                          className={cn(
                            "rounded-lg border p-3 transition-colors",
                            colorClass
                          )}
                        >
                          <CollapsibleTrigger asChild>
                            <div className="flex items-center justify-between cursor-pointer">
                              <div className="flex items-center gap-3">
                                <span className="font-mono text-sm text-muted-foreground">
                                  {event.time}
                                </span>
                                <span className="font-medium">{phaseLabel}</span>
                                {event.measurements && event.measurements.length > 0 && (
                                  <span className="text-xs text-muted-foreground">
                                    ({event.measurements.length} measurement
                                    {event.measurements.length !== 1 ? "s" : ""})
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                {!readOnly && (
                                  <div className="flex items-center gap-1">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEditingEvent(event);
                                      }}
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setDeletingEventId(eventId);
                                      }}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                )}
                                {isExpanded ? (
                                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                )}
                              </div>
                            </div>
                          </CollapsibleTrigger>

                          <CollapsibleContent className="mt-3 space-y-2">
                            {/* Measurements */}
                            {event.measurements && event.measurements.length > 0 && (
                              <div className="space-y-1">
                                {event.measurements.map((m, mIndex) => {
                                  const config = metricConfig[m.metric as keyof typeof metricConfig];
                                  const unitType = config && "unitType" in config ? config.unitType : undefined;
                                  const label = m.metric === "other"
                                    ? m.custom_metric || "Other"
                                    : config?.label || m.metric;

                                  return (
                                    <div
                                      key={mIndex}
                                      className="text-sm flex items-center gap-2"
                                    >
                                      <Thermometer className="h-3 w-3 text-muted-foreground" />
                                      <span>
                                        {label}:{" "}
                                        {unitType && typeof m.value === "number" ? (
                                          <UnitDisplay
                                            value={m.value}
                                            unitType={unitType}
                                            decimals={m.metric === "gravity_plato" ? 1 : m.metric === "temp_f" ? 1 : 2}
                                          />
                                        ) : (
                                          <>
                                            {m.value}
                                            {config?.unit ? ` ${config.unit}` : ""}
                                          </>
                                        )}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {/* Notes */}
                            {event.notes && (
                              <div className="text-sm text-muted-foreground border-t pt-2 mt-2">
                                {event.notes}
                              </div>
                            )}
                          </CollapsibleContent>
                        </div>
                      </div>
                    </Collapsible>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

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
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Event</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this event? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteEvent}
              disabled={isSubmitting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isSubmitting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
