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

import { useState, useCallback, useEffect, useRef } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Sortable,
  SortableContent,
  SortableItem,
  SortableItemHandle,
  SortableOverlay,
} from "@/components/ui/sortable";
import {
  SortableDragPreview,
  reorderWithPositions,
} from "@/components/ui/sortable-drag-preview";
import { UnitInput } from "@/components/ui/unit-input";
import { useTemperatureUnit } from "@/hooks/use-unit-preferences";
import { formatTemperature, formatTemperatureRange } from "@/domain/units";
import { Plus, Trash2, GripVertical, ChevronDown, Thermometer } from "lucide-react";

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
  const tempUnit = useTemperatureUnit();
  const [, setEditingId] = useState<string | null>(null);

  // Backfill IDs once if legacy data lacks them — required for stable drag-and-drop.
  // One-shot guard prevents re-running on parent re-renders (which can happen when
  // onChange has an unstable identity).
  const backfilledRef = useRef(false);
  useEffect(() => {
    if (backfilledRef.current) return;
    backfilledRef.current = true;
    if (steps.some((s) => !s.id)) {
      onChange(steps.map((s) => (s.id ? s : { ...s, id: generateId() })));
    }
  }, [steps, onChange]);

  const handleAddStep = useCallback(() => {
    const newStep: MashStep = {
      id: generateId(),
      step_type: "infusion",
      name: "New Step",
      temp_f: 152,
      duration_min: 60,
      position: steps.length,
    };
    onChange([...steps, newStep]);
    setEditingId(newStep.id || null);
  }, [steps, onChange]);

  const handleApplyPreset = useCallback(
    (presetKey: keyof typeof MASH_PRESETS) => {
      const preset = MASH_PRESETS[presetKey];
      const newSteps: MashStep[] = preset.steps.map((step, index) => ({
        id: generateId(),
        ...step,
        position: index,
      }));
      onChange(newSteps);
    },
    [onChange]
  );

  const handleUpdateStep = useCallback(
    (index: number, field: keyof MashStep, value: string | number) => {
      const updated = [...steps];
      updated[index] = { ...updated[index], [field]: value };
      onChange(updated);
    },
    [steps, onChange]
  );

  const handleRemove = useCallback(
    (index: number) => {
      onChange(reorderWithPositions(steps.filter((_, i) => i !== index)));
    },
    [steps, onChange]
  );

  const handleReorder = useCallback(
    (reordered: MashStep[]) => onChange(reorderWithPositions(reordered)),
    [onChange]
  );

  const totalTime = steps.reduce((sum, step) => sum + (step.duration_min || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Mash Schedule</h3>
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={disabled}>
                Presets
                <ChevronDown className="ml-1 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {Object.entries(MASH_PRESETS).map(([key, preset]) => (
                <DropdownMenuItem
                  key={key}
                  onClick={() => handleApplyPreset(key as keyof typeof MASH_PRESETS)}
                >
                  <div className="flex flex-col">
                    <span className="font-medium">{preset.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {preset.description}
                    </span>
                  </div>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onChange([])}
                className="text-destructive"
              >
                Clear All Steps
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            size="sm"
            onClick={handleAddStep}
            disabled={disabled}
          >
            <Plus className="mr-1 h-4 w-4" />
            Add Step
          </Button>
        </div>
      </div>

      {steps.length === 0 ? (
        <div className="border rounded-md p-8 text-center text-muted-foreground">
          <Thermometer className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No mash steps defined yet.</p>
          <p className="text-sm mt-1">
            Select a preset or click &quot;Add Step&quot; to build your mash schedule.
          </p>
        </div>
      ) : (
        <Sortable
          value={steps}
          onValueChange={handleReorder}
          getItemValue={(item) => item.id!}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead className="w-28">Type</TableHead>
                <TableHead>Step Name</TableHead>
                <TableHead className="w-32 text-right">Temp</TableHead>
                <TableHead className="w-24 text-right">Time (min)</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <SortableContent asChild>
              <TableBody>
                {steps.map((step, index) => (
                  <SortableItem key={step.id} value={step.id!} asChild disabled={disabled}>
                    <TableRow>
                      <TableCell>
                        <SortableItemHandle className="p-1 hover:bg-muted rounded touch-none">
                          <GripVertical className="h-4 w-4 text-muted-foreground" />
                        </SortableItemHandle>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={step.step_type}
                          onValueChange={(value) =>
                            handleUpdateStep(index, "step_type", value)
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
                          onChange={(e) => handleUpdateStep(index, "name", e.target.value)}
                          disabled={disabled}
                          className="min-w-[150px]"
                          placeholder="Step name"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <UnitInput
                          value={step.temp_f}
                          onChange={(value) =>
                            handleUpdateStep(index, "temp_f", value ?? 0)
                          }
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
                            handleUpdateStep(index, "duration_min", parseInt(e.target.value) || 0)
                          }
                          disabled={disabled}
                          className="w-20 text-right ml-auto"
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemove(index)}
                          disabled={disabled}
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  </SortableItem>
                ))}
              </TableBody>
            </SortableContent>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={4} className="font-medium">
                  Total Mash Time
                </TableCell>
                <TableCell className="text-right font-medium">
                  {totalTime} min
                </TableCell>
                <TableCell></TableCell>
              </TableRow>
            </TableFooter>
          </Table>
          <SortableOverlay>
            {({ value }) => {
              const step = steps.find((s) => s.id === value);
              return (
                <SortableDragPreview
                  title={step?.name || "Step"}
                  subtitle={step ? `${formatTemperature(step.temp_f, tempUnit, 0)} · ${step.duration_min} min` : undefined}
                />
              );
            }}
          </SortableOverlay>
        </Sortable>
      )}

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
