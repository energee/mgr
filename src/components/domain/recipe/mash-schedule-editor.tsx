"use client";

/**
 * MashScheduleEditor - Recipe Mash Schedule Management Component
 *
 * Editor for building multi-step mash schedules.
 * Features:
 * - Add/remove/reorder mash steps
 * - Common presets (single infusion, step mash, decoction)
 * - Per-step: type, name, target temp, rest time
 * - Temperature and time validation
 */

import { useCallback } from "react";
import {
  TableCell,
  TableRow,
  TableFooter,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SortableRows,
  SortableHandleCell,
  RemoveRowCell,
  SortableDragPreview,
  useSortableRows,
} from "@/components/ui/sortable-rows";
import { SchedulePresetsMenu } from "@/components/ui/schedule-presets-menu";
import { UnitInput } from "@/components/ui/unit-input";
import { useResolvedUnitPreferences } from "@/hooks/use-unit-preferences";
import { formatTemperature, formatTemperatureRange } from "@/domain/units";
import { Plus, Thermometer } from "lucide-react";

// Types for mash steps
export type MashStep = {
  id?: string;
  step_type: "infusion" | "decoction" | "direct_heat" | "rest";
  name: string;
  temp_f: number;
  duration_min: number;
  notes?: string;
  position: number;
}

type MashScheduleEditorProps = {
  steps: MashStep[];
  onChange: (steps: MashStep[]) => void;
  disabled?: boolean;
}

const generateId = () => `step-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

// Common step types with defaults
const STEP_TYPES = [
  { value: "infusion", label: "Infusion", description: "Add hot water" },
  { value: "decoction", label: "Decoction", description: "Remove, boil, return" },
  { value: "direct_heat", label: "Direct Heat", description: "Apply heat directly" },
  { value: "rest", label: "Rest", description: "Hold temperature" },
] as const;

// Common mash presets
const MASH_PRESETS = {
  single_infusion: {
    name: "Single Infusion",
    description: "Simple single-step mash at saccharification temp",
    steps: [
      { step_type: "infusion" as const, name: "Saccharification Rest", temp_f: 152, duration_min: 60 },
    ],
  },
  single_infusion_lower: {
    name: "Single Infusion (Dry)",
    description: "Single step at lower temp for drier finish",
    steps: [
      { step_type: "infusion" as const, name: "Saccharification Rest", temp_f: 148, duration_min: 60 },
    ],
  },
  protein_sacch: {
    name: "Protein + Saccharification",
    description: "Two-step with protein rest for wheat/rye beers",
    steps: [
      { step_type: "infusion" as const, name: "Protein Rest", temp_f: 122, duration_min: 20 },
      { step_type: "infusion" as const, name: "Saccharification Rest", temp_f: 152, duration_min: 60 },
    ],
  },
  step_mash: {
    name: "Step Mash",
    description: "Multi-step for complex grain bills",
    steps: [
      { step_type: "infusion" as const, name: "Acid Rest", temp_f: 95, duration_min: 15 },
      { step_type: "infusion" as const, name: "Protein Rest", temp_f: 122, duration_min: 20 },
      { step_type: "infusion" as const, name: "Beta Amylase Rest", temp_f: 145, duration_min: 30 },
      { step_type: "infusion" as const, name: "Alpha Amylase Rest", temp_f: 158, duration_min: 30 },
    ],
  },
  hochkurz: {
    name: "Hochkurz",
    description: "German two-step: beta then alpha amylase",
    steps: [
      { step_type: "infusion" as const, name: "Beta Rest", temp_f: 145, duration_min: 30 },
      { step_type: "infusion" as const, name: "Alpha Rest", temp_f: 162, duration_min: 20 },
    ],
  },
  decoction_single: {
    name: "Single Decoction",
    description: "Traditional decoction for malt depth",
    steps: [
      { step_type: "infusion" as const, name: "Initial Mash", temp_f: 145, duration_min: 20 },
      { step_type: "decoction" as const, name: "Decoction Pull", temp_f: 145, duration_min: 15 },
      { step_type: "rest" as const, name: "Saccharification", temp_f: 158, duration_min: 45 },
    ],
  },
};

export function MashScheduleEditor({
  steps,
  onChange,
  disabled = false,
}: MashScheduleEditorProps) {
  const tempUnit = useResolvedUnitPreferences().temperature_unit;
  const rows = useSortableRows({ items: steps, onChange, generateId });

  const handleApplyPreset = useCallback(
    (presetKey: keyof typeof MASH_PRESETS) => {
      onChange(
        MASH_PRESETS[presetKey].steps.map((step, index) => ({
          id: generateId(),
          ...step,
          position: index,
        }))
      );
    },
    [onChange]
  );

  const totalTime = steps.reduce((sum, step) => sum + (step.duration_min || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Mash Schedule</h3>
        <div className="flex gap-2">
          <SchedulePresetsMenu
            presets={MASH_PRESETS}
            onApply={handleApplyPreset}
            onClear={() => onChange([])}
            clearLabel="Clear All Steps"
            disabled={disabled}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              rows.append({
                id: generateId(),
                step_type: "infusion",
                name: "New Step",
                temp_f: 152,
                duration_min: 60,
              })
            }
            disabled={disabled}
          >
            <Plus className="mr-1 h-4 w-4" />
            Add Step
          </Button>
        </div>
      </div>

      <SortableRows
        items={steps}
        onReorder={rows.reorder}
        disabled={disabled}
        columns={[
          { className: "w-8" },
          { label: "Type", className: "w-28" },
          { label: "Step Name" },
          { label: "Temp", className: "w-32 text-right" },
          { label: "Time (min)", className: "w-24 text-right" },
          { className: "w-16" },
        ]}
        empty={
          <div className="border rounded-md p-8 text-center text-muted-foreground">
            <Thermometer className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No mash steps defined yet.</p>
            <p className="text-sm mt-1">
              Select a preset or click &quot;Add Step&quot; to build your mash schedule.
            </p>
          </div>
        }
        overlay={(step) => (
          <SortableDragPreview
            title={step?.name || "Step"}
            subtitle={
              step
                ? `${formatTemperature(step.temp_f, tempUnit, 0)} · ${step.duration_min} min`
                : undefined
            }
          />
        )}
        footer={
          <TableFooter>
            <TableRow>
              <TableCell colSpan={4} className="font-medium">
                Total Mash Time
              </TableCell>
              <TableCell className="text-right font-medium">{totalTime} min</TableCell>
              <TableCell></TableCell>
            </TableRow>
          </TableFooter>
        }
      >
        {(step, index) => (
          <TableRow>
            <SortableHandleCell />
            <TableCell>
              <Select
                value={step.step_type}
                onValueChange={(value) =>
                  rows.updateField(index, "step_type", value as MashStep["step_type"])
                }
                disabled={disabled}
              >
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STEP_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </TableCell>
            <TableCell>
              <Input
                value={step.name}
                onChange={(e) => rows.updateField(index, "name", e.target.value)}
                disabled={disabled}
                className="min-w-[150px]"
                placeholder="Step name"
              />
            </TableCell>
            <TableCell className="text-right">
              <UnitInput
                value={step.temp_f}
                onChange={(value) => rows.updateField(index, "temp_f", value ?? 0)}
                unitType="temperature"
                decimals={0}
                disabled={disabled}
                wrapperClassName="ml-auto"
                className="text-right"
              />
            </TableCell>
            <TableCell className="text-right">
              <Input
                type="number"
                step="5"
                min="0"
                value={step.duration_min || ""}
                onChange={(e) =>
                  rows.updateField(index, "duration_min", parseInt(e.target.value) || 0)
                }
                disabled={disabled}
                className="w-20 text-right ml-auto"
              />
            </TableCell>
            <RemoveRowCell onClick={() => rows.remove(index)} disabled={disabled} />
          </TableRow>
        )}
      </SortableRows>

      {steps.length > 0 && (
        <div className="text-xs text-muted-foreground border-t pt-3 space-y-1">
          <p className="font-medium">Temperature Reference:</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <span>Acid Rest: {formatTemperatureRange(95, 113, tempUnit)}</span>
            <span>Protein Rest: {formatTemperatureRange(113, 131, tempUnit)}</span>
            <span>Beta Amylase: {formatTemperatureRange(131, 150, tempUnit)}</span>
            <span>Alpha Amylase: {formatTemperatureRange(154, 162, tempUnit)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
