"use client";

/**
 * BatchReadingForm - Mobile-First Fermentation Reading Entry
 *
 * Touch-friendly form for recording fermentation metrics on brewery floor.
 * Features:
 * - Large touch targets (min 48px)
 * - Reading type selector with units
 * - Real-time validation with warnings
 * - Timestamp with default to now
 * - "Save & Add Another" keeps the form open (type/unit/timestamp preserved)
 *   so cellar rounds can log gravity + temp + pH in one visit
 * - Edit mode via `initialData` (prefilled, update semantics)
 * - `embedded` renders without the Card wrapper for use inside dialogs
 */

import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/form-resolver";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { UnitInput } from "@/components/ui/unit-input";
import type { UnitType } from "@/domain/units";
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
  FormDescription,
} from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, X } from "lucide-react";
import {
  READING_TYPES,
  validateReading,
  getUnitLabel,
  type ReadingType,
  type BatchReading,
} from "@/domain/batch-readings";
import { getCurrentDateTimeLocal } from "@/lib/utils";

const readingSchema = z.object({
  reading_type: z.enum([
    "gravity",
    "temperature",
    "ph",
    "pressure",
    "dissolved_oxygen",
    "diacetyl",
    "clarity",
  ]),
  value: z.union([z.coerce.number(), z.string()]),
  unit: z.string(),
  timestamp: z.string(),
  notes: z.string().optional(),
});

type ReadingFormValues = z.infer<typeof readingSchema>;

/**
 * Map reading types to UnitInput-compatible unit types.
 * Only gravity and temperature have meaningful unit conversions.
 * Returns undefined for types that should use plain number inputs.
 */
const READING_UNIT_TYPE_MAP: Partial<Record<ReadingType, UnitType>> = {
  gravity: "gravity",
  temperature: "temperature",
};

/** Canonical unit for each UnitInput-backed reading type */
const CANONICAL_UNIT_MAP: Partial<Record<ReadingType, string>> = {
  gravity: "plato",
  temperature: "f",
};

type BatchReadingFormProps = {
  batchId: string;
  onSubmit: (data: BatchReading) => Promise<void>;
  onCancel?: () => void;
  /**
   * Called after a plain Save (not "Save & Add Another") resolves —
   * typically closes the form/dialog. "Save & Add Another" instead keeps
   * the form open for the next metric.
   */
  onSaved?: () => void;
  isSubmitting?: boolean;
  /**
   * Existing reading to edit. Prefills all fields and switches the form to
   * update semantics ("Update Reading", no "Save & Add Another").
   */
  initialData?: BatchReading;
  /**
   * Render the bare form without the Card wrapper/header — for embedding in
   * a Dialog that supplies its own title and close affordance.
   */
  embedded?: boolean;
}

export function BatchReadingForm({
  onSubmit,
  onCancel,
  onSaved,
  isSubmitting = false,
  initialData,
  embedded = false,
}: BatchReadingFormProps) {
  const isEditing = !!initialData;
  const [selectedType, setSelectedType] = useState<ReadingType>(
    initialData?.reading_type ?? "gravity"
  );
  const [validationWarning, setValidationWarning] = useState<string | null>(null);
  // Set by the "Save & Add Another" button just before submit fires
  const addAnotherRef = useRef(false);

  const config = READING_TYPES[selectedType];

  const form = useForm<ReadingFormValues>({
    resolver: zodResolver(readingSchema),
    defaultValues: {
      reading_type: initialData?.reading_type ?? "gravity",
      value: initialData?.value ?? "",
      unit: initialData?.unit ?? (config?.defaultUnit || ""),
      // Normalize to datetime-local precision ("YYYY-MM-DDTHH:mm")
      timestamp: initialData?.timestamp?.slice(0, 16) || getCurrentDateTimeLocal(),
      notes: initialData?.notes ?? "",
    },
  });

  // Update default unit when type changes. Skips the initial mount so an
  // edit prefill (initialData) isn't immediately wiped.
  const prevTypeRef = useRef(selectedType);
  useEffect(() => {
    if (prevTypeRef.current === selectedType) return;
    prevTypeRef.current = selectedType;
    const newConfig = READING_TYPES[selectedType];
    form.setValue("unit", newConfig.defaultUnit);
    form.setValue("value", "");
    setValidationWarning(null);
  }, [selectedType, form]);

  // Validate value on change
  const watchValue = form.watch("value");
  useEffect(() => {
    if (watchValue === "" || watchValue === undefined) {
      setValidationWarning(null);
      return;
    }
    const result = validateReading(selectedType, watchValue);
    setValidationWarning(result.warning || null);
  }, [watchValue, selectedType]);

  const handleSubmit = async (values: ReadingFormValues) => {
    const validation = validateReading(selectedType, values.value);
    if (!validation.valid) {
      form.setError("value", { message: validation.warning });
      return;
    }

    const addAnother = addAnotherRef.current;
    addAnotherRef.current = false;

    try {
      await onSubmit({
        reading_type: values.reading_type,
        value: values.value,
        unit: values.unit,
        timestamp: values.timestamp,
        notes: values.notes,
      });
    } catch {
      // Save failed — the caller surfaces the error toast. Keep the form
      // populated so the entry isn't lost.
      return;
    }

    if (!addAnother) {
      // Plain save: the caller closes the form/dialog.
      onSaved?.();
      return;
    }

    // "Save & Add Another": keep the form open for the next metric of this
    // cellar round. Preserve type/unit/timestamp; clear only value + notes.
    form.reset({
      reading_type: values.reading_type,
      value: "",
      unit: values.unit,
      timestamp: values.timestamp,
      notes: "",
    });
  };

  const formBody = (
    <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
            {/* Reading Type - Large buttons for touch */}
            <FormField
              control={form.control}
              name="reading_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base">Reading Type</FormLabel>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {(Object.keys(READING_TYPES) as ReadingType[]).map((type) => (
                      <Button
                        key={type}
                        type="button"
                        variant={selectedType === type ? "default" : "outline"}
                        className="h-12 text-sm"
                        onClick={() => {
                          setSelectedType(type);
                          field.onChange(type);
                        }}
                        aria-label={`Select ${READING_TYPES[type].label} reading type`}
                        aria-pressed={selectedType === type}
                      >
                        {READING_TYPES[type].label}
                      </Button>
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Value Input - Large for touch */}
            {READING_UNIT_TYPE_MAP[selectedType] ? (
              /* UnitInput-backed types (gravity, temperature) - includes built-in unit switching */
              <FormField
                control={form.control}
                name="value"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Value</FormLabel>
                    <FormControl>
                      <UnitInput
                        value={typeof field.value === "number" ? field.value : null}
                        onChange={(val) => {
                          field.onChange(val ?? "");
                          // Keep the unit field in sync with the canonical unit
                          form.setValue("unit", CANONICAL_UNIT_MAP[selectedType] ?? config.defaultUnit);
                        }}
                        unitType={READING_UNIT_TYPE_MAP[selectedType]!}
                        allowSwitch
                        decimals={selectedType === "gravity" ? 3 : 1}
                        placeholder={`${config.min || 0} - ${config.max || 100}`}
                        className="h-12 text-lg"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : (
              /* Non-UnitInput types - plain number input with separate unit selector */
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <FormField
                    control={form.control}
                    name="value"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-base">Value</FormLabel>
                        <FormControl>
                          {config.options ? (
                            <Select
                              value={String(field.value)}
                              onValueChange={field.onChange}
                            >
                              <SelectTrigger className="h-12 text-lg">
                                <SelectValue placeholder="Select..." />
                              </SelectTrigger>
                              <SelectContent>
                                {config.options.map((option) => (
                                  <SelectItem key={option} value={option}>
                                    {option.charAt(0).toUpperCase() + option.slice(1)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input
                              type="number"
                              step={config.step || "any"}
                              min={config.min}
                              max={config.max}
                              placeholder={`${config.min || 0} - ${config.max || 100}`}
                              className="h-12 text-lg"
                              {...field}
                            />
                          )}
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Unit Selector */}
                <FormField
                  control={form.control}
                  name="unit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-base">Unit</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={config.units.length <= 1}
                      >
                        <SelectTrigger className="h-12">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {config.units.map((unit) => (
                            <SelectItem key={unit} value={unit}>
                              {getUnitLabel(selectedType, unit)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            {/* Validation Warning */}
            {validationWarning && (
              <div className="flex items-center gap-2 rounded-md bg-amber-50 p-3 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                <AlertTriangle className="h-5 w-5 flex-shrink-0" />
                <span className="text-sm">{validationWarning}</span>
              </div>
            )}

            {/* Timestamp */}
            <FormField
              control={form.control}
              name="timestamp"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base">Date/Time</FormLabel>
                  <FormControl>
                    <Input
                      type="datetime-local"
                      className="h-12"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>Defaults to now</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Submit Buttons - Full width for mobile */}
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
              {!isEditing && (
                <Button
                  type="submit"
                  variant="secondary"
                  className="h-12 sm:w-auto"
                  disabled={isSubmitting}
                  onClick={() => {
                    addAnotherRef.current = true;
                  }}
                >
                  {isSubmitting ? "Saving..." : "Save & Add Another"}
                </Button>
              )}
              <Button
                type="submit"
                className="h-12 sm:w-auto"
                disabled={isSubmitting}
              >
                {isSubmitting
                  ? isEditing
                    ? "Updating..."
                    : "Saving..."
                  : isEditing
                    ? "Update Reading"
                    : "Save Reading"}
              </Button>
            </div>
          </form>
        </Form>
  );

  // Embedded: bare form for dialogs that provide their own title/close.
  if (embedded) {
    return formBody;
  }

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <CardTitle className="text-xl">
          {isEditing ? "Edit Reading" : "Add Reading"}
        </CardTitle>
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close"
            onClick={onCancel}
            className="h-10 w-10"
          >
            <X className="h-5 w-5" />
          </Button>
        )}
      </CardHeader>
      <CardContent>{formBody}</CardContent>
    </Card>
  );
}
