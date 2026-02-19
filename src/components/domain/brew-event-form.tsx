"use client";

/**
 * BrewEventForm - Mobile-First Brew Day Event Entry
 *
 * Touch-friendly form for recording brew day events on brewery floor.
 * Phases and metrics are fetched from the enum_values table so breweries
 * can customize them via Settings > Status & Options.
 */

import { useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@/lib/form-resolver";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TimePicker } from "@/components/ui/time-picker";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Plus, Trash2 } from "lucide-react";
import { UnitInput } from "@/components/ui/unit-input";
import { useBrewPhases, useBrewMetrics } from "@/hooks/use-brew-enums";
import { Skeleton } from "@/components/ui/skeleton";
import type { BrewEvent, BrewMeasurement } from "@/entities/brew-log";

// =============================================================================
// Schema — uses z.string() since valid values come from the database
// =============================================================================

const measurementFormSchema = z.object({
  metric: z.string().min(1, "Metric is required"),
  value: z.union([z.coerce.number(), z.string()]).refine(
    (val) => val !== "" && val !== undefined,
    { message: "Value is required" }
  ),
  custom_metric: z.string().nullable().optional(),
});

const eventFormSchema = z.object({
  phase: z.string().min(1, "Phase is required"),
  custom_phase: z.string().nullable().optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Time must be in HH:MM format"),
  measurements: z.array(measurementFormSchema),
  notes: z.string().nullable().optional(),
});

type EventFormValues = z.infer<typeof eventFormSchema>;

// =============================================================================
// Component
// =============================================================================

interface BrewEventFormProps {
  onSubmit: (data: BrewEvent) => Promise<void>;
  onCancel?: () => void;
  isSubmitting?: boolean;
  initialData?: Partial<BrewEvent>;
}

function getCurrentTime(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function BrewEventForm({
  onSubmit,
  onCancel,
  isSubmitting = false,
  initialData,
}: BrewEventFormProps) {
  const { data: phaseData, isLoading: phasesLoading } = useBrewPhases();
  const { data: metricData, isLoading: metricsLoading } = useBrewMetrics();

  const [selectedPhase, setSelectedPhase] = useState<string>(
    initialData?.phase || "mash_in"
  );

  const form = useForm<EventFormValues>({
    resolver: zodResolver(eventFormSchema),
    defaultValues: {
      phase: initialData?.phase || "mash_in",
      custom_phase: initialData?.custom_phase || "",
      time: initialData?.time || getCurrentTime(),
      measurements: (initialData?.measurements as BrewMeasurement[]) || [],
      notes: initialData?.notes || "",
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "measurements",
  });

  const handleSubmit = async (values: EventFormValues) => {
    const event: BrewEvent = {
      id: initialData?.id || crypto.randomUUID(),
      phase: values.phase,
      custom_phase: values.phase === "other" ? values.custom_phase : null,
      time: values.time,
      measurements: values.measurements.map((m) => ({
        metric: m.metric,
        value: m.value,
        custom_metric: m.metric === "other" ? m.custom_metric : null,
      })),
      notes: values.notes || null,
    };

    await onSubmit(event);
  };

  const addMeasurement = () => {
    let defaultMetric = "temp_f";

    if (selectedPhase === "boil_end" || selectedPhase === "ko_end") {
      defaultMetric = "gravity_plato";
    } else if (selectedPhase === "hop_addition" || selectedPhase === "adjunct_addition") {
      defaultMetric = "amount_oz";
    }

    append({ metric: defaultMetric, value: "", custom_metric: null });
  };

  if (phasesLoading || metricsLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  const phaseGroups = phaseData?.groups ?? [];
  const metricsList = metricData?.metrics ?? [];
  const metricConfigMap = metricData?.configMap ?? new Map();

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        {/* Phase Selector - Grouped */}
        <FormField
          control={form.control}
          name="phase"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-base">Phase</FormLabel>
              <Select
                value={field.value}
                onValueChange={(value) => {
                  field.onChange(value);
                  setSelectedPhase(value);
                }}
              >
                <SelectTrigger className="h-12">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {phaseGroups.map(({ group, phases }) => (
                    <div key={group}>
                      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase">
                        {group}
                      </div>
                      {phases.map((phase) => (
                        <SelectItem key={phase.value} value={phase.value}>
                          {phase.label}
                        </SelectItem>
                      ))}
                    </div>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Custom Phase (when "other" selected) */}
        {selectedPhase === "other" && (
          <FormField
            control={form.control}
            name="custom_phase"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">Custom Phase Name</FormLabel>
                <FormControl>
                  <Input
                    placeholder="e.g., Decoction pull"
                    className="h-12"
                    {...field}
                    value={field.value || ""}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {/* Time */}
        <FormField
          control={form.control}
          name="time"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-base">Time</FormLabel>
              <FormControl>
                <TimePicker
                  value={field.value}
                  onChange={field.onChange}
                  minuteStep={1}
                  className="h-12"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Measurements */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <FormLabel className="text-base">Measurements</FormLabel>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addMeasurement}
              className="h-9"
            >
              <Plus className="mr-1 h-4 w-4" />
              Add
            </Button>
          </div>

          {fields.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No measurements added. Click &quot;Add&quot; to record a measurement.
            </p>
          )}

          {fields.map((field, index) => (
            <div
              key={field.id}
              className="grid grid-cols-12 gap-2 rounded-lg border p-3"
            >
              {/* Metric Type */}
              <div className="col-span-5">
                <FormField
                  control={form.control}
                  name={`measurements.${index}.metric`}
                  render={({ field }) => (
                    <FormItem>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <SelectTrigger className="h-10">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {metricsList.map((metric) => (
                            <SelectItem key={metric.value} value={metric.value}>
                              {metric.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Value */}
              <div className="col-span-5">
                <FormField
                  control={form.control}
                  name={`measurements.${index}.value`}
                  render={({ field }) => {
                    // eslint-disable-next-line react-hooks/incompatible-library -- React Hook Form watch() incompatible with React Compiler
                    const metricKey = form.watch(`measurements.${index}.metric`);
                    const config = metricConfigMap.get(metricKey);

                    return (
                      <FormItem>
                        <FormControl>
                          {config?.unitType ? (
                            <UnitInput
                              value={typeof field.value === "number" ? field.value : null}
                              onChange={(val) => field.onChange(val ?? "")}
                              unitType={config.unitType}
                              decimals={config.decimals ?? 2}
                            />
                          ) : (
                            <div className="flex items-center gap-1">
                              <Input
                                type="text"
                                inputMode="decimal"
                                placeholder="Value"
                                className="h-10"
                                {...field}
                              />
                              <span className="text-sm text-muted-foreground min-w-[40px]">
                                {config?.unit || ""}
                              </span>
                            </div>
                          )}
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    );
                  }}
                />
              </div>

              {/* Remove Button */}
              <div className="col-span-2 flex items-center justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(index)}
                  className="h-10 w-10 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        {/* Notes */}
        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-base">Notes (optional)</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Any observations..."
                  className="min-h-[80px] text-base"
                  {...field}
                  value={field.value || ""}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Submit Buttons */}
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              className="h-12 sm:w-auto"
              disabled={isSubmitting}
            >
              Cancel
            </Button>
          )}
          <Button
            type="submit"
            className="h-12 sm:w-auto"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Saving..." : "Save Event"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
