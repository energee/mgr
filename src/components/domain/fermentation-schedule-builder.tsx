"use client";

/**
 * FermentationScheduleBuilder - Recipe Fermentation Stages Editor
 *
 * Manages the fermentation schedule for lagers, ales, and mixed fermentation.
 * Features:
 * - Stage types (primary, secondary, lagering, etc.)
 * - Temperature and duration
 * - Diacetyl rest, dry hop timing
 */

import { useState } from "react";
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
import { Plus, Trash2, ChevronDown } from "lucide-react";

export interface FermentationStage {
  id: string;
  stage: "primary" | "secondary" | "diacetyl" | "lagering" | "conditioning" | "dry_hop" | "cold_crash";
  name: string;
  temp_f: number;
  duration_days: number;
  notes?: string;
}

const STAGE_TYPES = [
  { value: "primary", label: "Primary", color: "default" },
  { value: "secondary", label: "Secondary", color: "info" },
  { value: "diacetyl", label: "Diacetyl Rest", color: "warning" },
  { value: "lagering", label: "Lagering", color: "info" },
  { value: "conditioning", label: "Conditioning", color: "success" },
  { value: "dry_hop", label: "Dry Hop", color: "success" },
  { value: "cold_crash", label: "Cold Crash", color: "secondary" },
] as const;

// Common fermentation presets
const STAGE_PRESETS = [
  { name: "Primary Fermentation", stage: "primary", temp_f: 68, duration_days: 7 },
  { name: "Secondary Fermentation", stage: "secondary", temp_f: 68, duration_days: 14 },
  { name: "Diacetyl Rest", stage: "diacetyl", temp_f: 68, duration_days: 2 },
  { name: "Cold Lagering", stage: "lagering", temp_f: 34, duration_days: 30 },
  { name: "Dry Hop Addition", stage: "dry_hop", temp_f: 65, duration_days: 3 },
  { name: "Cold Crash", stage: "cold_crash", temp_f: 34, duration_days: 2 },
  { name: "Conditioning (Brite)", stage: "conditioning", temp_f: 38, duration_days: 7 },
] as const;

interface FermentationScheduleBuilderProps {
  stages: FermentationStage[];
  onChange: (stages: FermentationStage[]) => void;
  disabled?: boolean;
}

export function FermentationScheduleBuilder({
  stages,
  onChange,
  disabled = false,
}: FermentationScheduleBuilderProps) {
  // Generate unique ID
  const generateId = () => `stage_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  // Add stage from preset
  const handleAddPreset = (preset: typeof STAGE_PRESETS[number]) => {
    const newStage: FermentationStage = {
      id: generateId(),
      stage: preset.stage as FermentationStage["stage"],
      name: preset.name,
      temp_f: preset.temp_f,
      duration_days: preset.duration_days,
    };
    onChange([...stages, newStage]);
  };

  // Add blank stage
  const handleAddBlank = () => {
    const newStage: FermentationStage = {
      id: generateId(),
      stage: "primary",
      name: "New Stage",
      temp_f: 68,
      duration_days: 7,
    };
    onChange([...stages, newStage]);
  };

  // Remove stage
  const handleRemove = (id: string) => {
    onChange(stages.filter((s) => s.id !== id));
  };

  // Update stage field
  const handleUpdate = (id: string, field: keyof FermentationStage, value: unknown) => {
    onChange(
      stages.map((s) => (s.id === id ? { ...s, [field]: value } : s))
    );
  };

  // Calculate total time
  const totalDays = stages.reduce((sum, s) => sum + s.duration_days, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Fermentation Schedule</h4>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={disabled}>
              <Plus className="h-4 w-4 mr-1" />
              Add Stage
              <ChevronDown className="h-4 w-4 ml-1" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {STAGE_PRESETS.map((preset) => (
              <DropdownMenuItem
                key={preset.name}
                onClick={() => handleAddPreset(preset)}
              >
                {preset.name} ({preset.duration_days}d)
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onClick={handleAddBlank}>
              <span className="text-muted-foreground">Custom Stage...</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {stages.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-4 border rounded-md border-dashed">
          No fermentation stages defined. Add stages to create a schedule.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Stage</TableHead>
              <TableHead className="w-[130px]">Type</TableHead>
              <TableHead className="w-[100px]">Temp</TableHead>
              <TableHead className="w-[100px]">Duration</TableHead>
              <TableHead className="w-[50px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {stages.map((stage) => {
              const stageType = STAGE_TYPES.find((t) => t.value === stage.stage);
              return (
                <TableRow key={stage.id}>
                  <TableCell>
                    <Input
                      value={stage.name}
                      onChange={(e) => handleUpdate(stage.id, "name", e.target.value)}
                      disabled={disabled}
                      className="h-8"
                    />
                  </TableCell>
                  <TableCell>
                    <Select
                      value={stage.stage}
                      onValueChange={(v) => handleUpdate(stage.id, "stage", v)}
                      disabled={disabled}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STAGE_TYPES.map((type) => (
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
                        value={stage.temp_f}
                        onChange={(e) =>
                          handleUpdate(stage.id, "temp_f", parseInt(e.target.value) || 0)
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
                        value={stage.duration_days}
                        onChange={(e) =>
                          handleUpdate(stage.id, "duration_days", parseInt(e.target.value) || 0)
                        }
                        disabled={disabled}
                        className="h-8 w-16"
                      />
                      <span className="text-sm text-muted-foreground">days</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemove(stage.id)}
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
              <TableCell colSpan={3} className="text-right font-medium">
                Total Fermentation Time
              </TableCell>
              <TableCell colSpan={2}>
                <Badge variant="outline">
                  {totalDays} days ({Math.round(totalDays / 7 * 10) / 10} weeks)
                </Badge>
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )}
    </div>
  );
}
