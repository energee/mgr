"use client";

/**
 * MashScheduleBuilder - Recipe Mash Steps Editor
 *
 * Manages the mash schedule for step mashing, decoction, and infusion.
 * Features:
 * - Step types (infusion, decoction, rest, mashout)
 * - Temperature and duration for each step
 * - Drag-to-reorder
 * - Common step presets
 */

import { useCallback, useRef } from "react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, Trash2, GripVertical, ChevronDown } from "lucide-react";

export type MashStep = {
  id: string;
  step_type: "infusion" | "decoction" | "rest" | "mashout" | "acid_rest" | "protein_rest";
  name: string;
  temp_f: number;
  duration_min: number;
  notes?: string;
}

const STEP_TYPES = [
  { value: "infusion", label: "Infusion", color: "default" },
  { value: "decoction", label: "Decoction", color: "warning" },
  { value: "rest", label: "Rest", color: "info" },
  { value: "mashout", label: "Mash Out", color: "success" },
  { value: "acid_rest", label: "Acid Rest", color: "secondary" },
  { value: "protein_rest", label: "Protein Rest", color: "secondary" },
] as const;

// Common mash step presets
const STEP_PRESETS = [
  { name: "Acid Rest", step_type: "acid_rest", temp_f: 95, duration_min: 15 },
  { name: "Protein Rest", step_type: "protein_rest", temp_f: 122, duration_min: 20 },
  { name: "Beta Rest (Fermentable)", step_type: "rest", temp_f: 145, duration_min: 30 },
  { name: "Alpha Rest (Body)", step_type: "rest", temp_f: 156, duration_min: 30 },
  { name: "Single Infusion", step_type: "infusion", temp_f: 152, duration_min: 60 },
  { name: "Saccharification", step_type: "rest", temp_f: 152, duration_min: 60 },
  { name: "Mash Out", step_type: "mashout", temp_f: 170, duration_min: 10 },
] as const;

type MashScheduleBuilderProps = {
  steps: MashStep[];
  onChange: (steps: MashStep[]) => void;
  disabled?: boolean;
}

export function MashScheduleBuilder({
  steps,
  onChange,
  disabled = false,
}: MashScheduleBuilderProps) {
  // Generate unique ID
  const idCounter = useRef(0);
  const generateId = useCallback(() => `step_${++idCounter.current}_${crypto.randomUUID().slice(0, 7)}`, []);

  // Add step from preset
  const handleAddPreset = (preset: typeof STEP_PRESETS[number]) => {
    const newStep: MashStep = {
      id: generateId(),
      step_type: preset.step_type as MashStep["step_type"],
      name: preset.name,
      temp_f: preset.temp_f,
      duration_min: preset.duration_min,
    };
    onChange([...steps, newStep]);
  };

  // Add blank step
  const handleAddBlank = () => {
    const newStep: MashStep = {
      id: generateId(),
      step_type: "rest",
      name: "New Step",
      temp_f: 152,
      duration_min: 60,
    };
    onChange([...steps, newStep]);
  };

  // Remove step
  const handleRemove = (id: string) => {
    onChange(steps.filter((s) => s.id !== id));
  };

  // Update step field
  const handleUpdate = (id: string, field: keyof MashStep, value: unknown) => {
    onChange(
      steps.map((s) => (s.id === id ? { ...s, [field]: value } : s))
    );
  };

  // Calculate total time
  const totalTime = steps.reduce((sum, s) => sum + s.duration_min, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Mash Schedule</h4>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={disabled}>
              <Plus className="h-4 w-4 mr-1" />
              Add Step
              <ChevronDown className="h-4 w-4 ml-1" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {STEP_PRESETS.map((preset) => (
              <DropdownMenuItem
                key={preset.name}
                onClick={() => handleAddPreset(preset)}
              >
                {preset.name} ({preset.temp_f}°F)
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onClick={handleAddBlank}>
              <span className="text-muted-foreground">Custom Step...</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {steps.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-4 border rounded-md border-dashed">
          No mash steps defined. Add steps to create a mash schedule.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[30px]" />
              <TableHead>Step</TableHead>
              <TableHead className="w-[120px]">Type</TableHead>
              <TableHead className="w-[100px]">Temp</TableHead>
              <TableHead className="w-[100px]">Duration</TableHead>
              <TableHead className="w-[50px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {steps.map((step) => {
              return (
                <TableRow key={step.id}>
                  <TableCell className="text-muted-foreground">
                    <GripVertical className="h-4 w-4" />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={step.name}
                      onChange={(e) => handleUpdate(step.id, "name", e.target.value)}
                      disabled={disabled}
                      className="h-8"
                    />
                  </TableCell>
                  <TableCell>
                    <Select
                      value={step.step_type}
                      onValueChange={(v) => handleUpdate(step.id, "step_type", v)}
                      disabled={disabled}
                    >
                      <SelectTrigger className="h-8">
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
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        value={step.temp_f}
                        onChange={(e) =>
                          handleUpdate(step.id, "temp_f", parseInt(e.target.value) || 0)
                        }
                        disabled={disabled}
                        className="h-8 w-16"
                      />
                      <span className="text-sm text-muted-foreground">°F</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        value={step.duration_min}
                        onChange={(e) =>
                          handleUpdate(step.id, "duration_min", parseInt(e.target.value) || 0)
                        }
                        disabled={disabled}
                        className="h-8 w-16"
                      />
                      <span className="text-sm text-muted-foreground">min</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remove mash step"
                      onClick={() => handleRemove(step.id)}
                      disabled={disabled}
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={4} className="text-right font-medium">
                Total Mash Time
              </TableCell>
              <TableCell colSpan={2}>
                <Badge variant="outline">
                  {Math.floor(totalTime / 60)}h {totalTime % 60}m
                </Badge>
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )}
    </div>
  );
}
