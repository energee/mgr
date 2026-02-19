"use client";

/**
 * BrewEventForm - Mobile-First Brew Day Event Entry
 *
 * Touch-friendly form for recording brew day events on brewery floor.
 * Features:
 * - Large touch targets (min 48px)
 * - Phase selector with common brewing phases
 * - Multiple measurements per event
 * - Timestamp with time-only input (brew day is known)
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
import {
  phaseConfig,
  metricConfig,
  type BrewEvent,
  type BrewMeasurement,
} from "@/entities/brew-log";

// =============================================================================
// Schema
// =============================================================================

const measurementFormSchema = z.object({
  metric: z.enum([
    "temp_f",
    "ph",
    "volume_bbl",
    "volume_l",
    "gravity_plato",
    "flow_rate",
    "pump_speed",
    "amount_lbs",
    "amount_oz",
    "amount_g",
    "viability",
    "pitch_rate",
    "other",
  ]),
  value: z.union([z.coerce.number(), z.string()]).refine(
    (val) => val !== "" && val !== undefined,
    { message: "Value is required" }
  ),
  custom_metric: z.string().nullable().optional(),
});

const eventFormSchema = z.object({
  phase: z.enum([
    "strike_water",
    "mash_in",
    "mash_rest",
    "mash_step",
    "vorlauf",
    "runoff_start",
    "runoff_end",
    "sparge_start",
    "sparge_end",
    "kettle_full",
    "boil_start",
    "boil_end",
    "hop_addition",
    "adjunct_addition",
    "whirlpool_start",
    "whirlpool_rest",
    "whirlpool_end",
    "ko_start",
    "ko_end",
    "yeast_pitch",
    "hourly_check",
    "flow_rate_change",
    "other",
  ]),
  custom_phase: z.string().nullable().optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Time must be in HH:MM format"),
  measurements: z.array(measurementFormSchema),
  notes: z.string().nullable().optional(),
});

type EventFormValues = z.infer<typeof eventFormSchema>;

// =============================================================================
// Phase Groups for Better UX
// =============================================================================

const phaseGroups = {
  mash: ["strike_water", "mash_in", "mash_rest", "mash_step"],
  lauter: ["vorlauf", "runoff_start", "runoff_end", "sparge_start", "sparge_end"],
  boil: ["kettle_full", "boil_start", "hop_addition", "adjunct_addition", "boil_end"],
  whirlpool: ["whirlpool_start", "whirlpool_rest", "whirlpool_end"],
  knockout: ["ko_start", "ko_end", "yeast_pitch"],
  other: ["hourly_check", "flow_rate_change", "other"],
} as const;

// =============================================================================
// Component
// =============================================================================

interface BrewEventFormProps {
  onSubmit: (data: BrewEvent) => Promise<void>;
  onCancel?: () => void;
  isSubmitting?: boolean;
  initialData?: Partial<BrewEvent>;
}

export function BrewEventForm({
  onSubmit,
  onCancel,
  isSubmitting = false,
  initialData,
}: BrewEventFormProps) {
  const [selectedPhase, setSelectedPhase] = useState<string>(
    initialData?.phase || "mash_in"
  );

  // Get current time in HH:MM format
  const getCurrentTime = () => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(
      now.getMinutes()
    ).padStart(2, "0")}`;
  };

  const form = useForm<EventFormValues>({
    resolver: zodResolver(eventFormSchema),
    defaultValues: {
      phase: (initialData?.phase as EventFormValues["phase"]) || "mash_in",
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
    let defaultMetric: BrewMeasurement["metric"] = "temp_f";

    if (selectedPhase === "boil_end" || selectedPhase === "ko_end") {
      defaultMetric = "gravity_plato";
    } else if (selectedPhase === "hop_addition" || selectedPhase === "adjunct_addition") {
      defaultMetric = "amount_oz";
    }

    append({ metric: defaultMetric, value: "", custom_metric: null });
  };

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
                      {Object.entries(phaseGroups).map(([group, phases]) => (
                        <div key={group}>
                          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase">
                            {group}
                          </div>
                          {phases.map((phase) => (
                            <SelectItem key={phase} value={phase}>
                              {phaseConfig[phase as keyof typeof phaseConfig]?.label || phase}
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
                              {Object.entries(metricConfig).map(([key, config]) => (
                                <SelectItem key={key} value={key}>
                                  {config.label}
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
                        const metricKey = form.watch(`measurements.${index}.metric`) as keyof typeof metricConfig;
                        const config = metricConfig[metricKey];
                        const unitType = config && "unitType" in config ? config.unitType : undefined;
                        const decimals = config && "decimals" in config ? config.decimals : 2;

                        return (
                          <FormItem>
                            <FormControl>
                              {unitType ? (
                                <UnitInput
                                  value={typeof field.value === "number" ? field.value : null}
                                  onChange={(val) => field.onChange(val ?? "")}
                                  unitType={unitType}
                                  decimals={decimals}
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
