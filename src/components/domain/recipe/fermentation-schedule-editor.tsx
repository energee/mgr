"use client";

/**
 * FermentationScheduleEditor - Recipe Fermentation Schedule Management Component
 *
 * Editor for building fermentation temperature schedules.
 * Features:
 * - Add/remove/reorder fermentation stages
 * - Common presets (ale, lager, saison, etc.)
 * - Per-stage: name, target temp, duration
 * - Dry hop timing notes
 */

import { useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { useResolvedUnitPreferences } from "@/hooks/use-unit-preferences";
import { formatTemperature } from "@/domain/units";
import { Plus, Trash2, GripVertical, ChevronDown, FlaskConical, ChevronRight } from "lucide-react";

// Types for fermentation stages
export type FermentationStage = {
  id?: string;
  stage: "primary" | "secondary" | "diacetyl_rest" | "cold_crash" | "conditioning" | "lagering" | "custom";
  name: string;
  temp_f: number;
  duration_days: number;
  notes?: string;
  position: number;
}

type FermentationScheduleEditorProps = {
  stages: FermentationStage[];
  onChange: (stages: FermentationStage[]) => void;
  disabled?: boolean;
}

const generateId = () => `stage-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

// Stage types with defaults
const STAGE_TYPES = [
  { value: "primary", label: "Primary", defaultTemp: 68, defaultDays: 7 },
  { value: "secondary", label: "Secondary", defaultTemp: 68, defaultDays: 14 },
  { value: "diacetyl_rest", label: "Diacetyl Rest", defaultTemp: 68, defaultDays: 3 },
  { value: "cold_crash", label: "Cold Crash", defaultTemp: 34, defaultDays: 3 },
  { value: "conditioning", label: "Conditioning", defaultTemp: 68, defaultDays: 14 },
  { value: "lagering", label: "Lagering", defaultTemp: 34, defaultDays: 30 },
  { value: "custom", label: "Custom", defaultTemp: 68, defaultDays: 7 },
] as const;

// Common fermentation presets
const FERMENTATION_PRESETS = {
  ale_standard: {
    name: "Standard Ale",
    description: "Simple ale fermentation",
    stages: [
      { stage: "primary" as const, name: "Primary Fermentation", temp_f: 68, duration_days: 10 },
      { stage: "cold_crash" as const, name: "Cold Crash", temp_f: 34, duration_days: 3 },
    ],
  },
  ale_with_dry_hop: {
    name: "Ale with Dry Hop",
    description: "Ale with secondary dry hop period",
    stages: [
      { stage: "primary" as const, name: "Primary Fermentation", temp_f: 68, duration_days: 7 },
      { stage: "secondary" as const, name: "Dry Hop", temp_f: 68, duration_days: 4, notes: "Add dry hops" },
      { stage: "cold_crash" as const, name: "Cold Crash", temp_f: 34, duration_days: 3 },
    ],
  },
  neipa: {
    name: "NEIPA",
    description: "Hazy IPA with biotransformation dry hop",
    stages: [
      { stage: "primary" as const, name: "Active Fermentation", temp_f: 66, duration_days: 3 },
      { stage: "secondary" as const, name: "Biotransformation Dry Hop", temp_f: 66, duration_days: 4, notes: "Add dry hops at high krausen" },
      { stage: "secondary" as const, name: "Second Dry Hop", temp_f: 66, duration_days: 3, notes: "Add second dry hop charge" },
      { stage: "cold_crash" as const, name: "Soft Crash", temp_f: 40, duration_days: 2 },
    ],
  },
  saison: {
    name: "Saison",
    description: "Belgian saison with temp ramp",
    stages: [
      { stage: "primary" as const, name: "Initial Fermentation", temp_f: 68, duration_days: 3 },
      { stage: "primary" as const, name: "Temperature Ramp", temp_f: 78, duration_days: 4, notes: "Raise temp gradually each day" },
      { stage: "primary" as const, name: "Final Attenuation", temp_f: 85, duration_days: 7, notes: "Hold warm until FG stable" },
      { stage: "conditioning" as const, name: "Conditioning", temp_f: 68, duration_days: 14 },
    ],
  },
  lager_traditional: {
    name: "Traditional Lager",
    description: "Classic lager with extended lagering",
    stages: [
      { stage: "primary" as const, name: "Primary Fermentation", temp_f: 50, duration_days: 14 },
      { stage: "diacetyl_rest" as const, name: "Diacetyl Rest", temp_f: 65, duration_days: 3 },
      { stage: "lagering" as const, name: "Lagering", temp_f: 34, duration_days: 42, notes: "1 week per 2°P OG" },
    ],
  },
  lager_fast: {
    name: "Fast Lager",
    description: "Accelerated lager schedule",
    stages: [
      { stage: "primary" as const, name: "Primary (Cool)", temp_f: 48, duration_days: 7 },
      { stage: "primary" as const, name: "Primary (Warm)", temp_f: 55, duration_days: 5, notes: "Raise gradually" },
      { stage: "diacetyl_rest" as const, name: "Diacetyl Rest", temp_f: 65, duration_days: 2 },
      { stage: "cold_crash" as const, name: "Crash & Lager", temp_f: 34, duration_days: 14 },
    ],
  },
  belgian_strong: {
    name: "Belgian Strong",
    description: "Belgian abbey style with conditioning",
    stages: [
      { stage: "primary" as const, name: "Primary Fermentation", temp_f: 64, duration_days: 7 },
      { stage: "secondary" as const, name: "Secondary", temp_f: 68, duration_days: 14 },
      { stage: "conditioning" as const, name: "Bottle Conditioning", temp_f: 70, duration_days: 30 },
    ],
  },
};

export function FermentationScheduleEditor({
  stages,
  onChange,
  disabled = false,
}: FermentationScheduleEditorProps) {
  const tempUnit = useResolvedUnitPreferences().temperature_unit;
  // Backfill IDs once if legacy data lacks them — required for stable drag-and-drop.
  // One-shot guard prevents re-running on parent re-renders (which can happen when
  // onChange has an unstable identity).
  const backfilledRef = useRef(false);
  useEffect(() => {
    if (backfilledRef.current) return;
    backfilledRef.current = true;
    if (stages.some((s) => !s.id)) {
      onChange(stages.map((s) => (s.id ? s : { ...s, id: generateId() })));
    }
  }, [stages, onChange]);

  const handleAddStage = useCallback(() => {
    const newStage: FermentationStage = {
      id: generateId(),
      stage: "primary",
      name: "New Stage",
      temp_f: 68,
      duration_days: 7,
      position: stages.length,
    };
    onChange([...stages, newStage]);
  }, [stages, onChange]);

  const handleApplyPreset = useCallback(
    (presetKey: keyof typeof FERMENTATION_PRESETS) => {
      const preset = FERMENTATION_PRESETS[presetKey];
      const newStages: FermentationStage[] = preset.stages.map((stage, index) => ({
        id: generateId(),
        ...stage,
        position: index,
      }));
      onChange(newStages);
    },
    [onChange]
  );

  const handleUpdateStage = useCallback(
    (index: number, field: keyof FermentationStage, value: string | number) => {
      const updated = [...stages];
      updated[index] = { ...updated[index], [field]: value };
      onChange(updated);
    },
    [stages, onChange]
  );

  const handleStageTypeChange = useCallback(
    (index: number, stageType: FermentationStage["stage"]) => {
      const typeConfig = STAGE_TYPES.find((t) => t.value === stageType);
      const updated = [...stages];
      updated[index] = {
        ...updated[index],
        stage: stageType,
        name: updated[index].name === "New Stage" ? (typeConfig?.label || stageType) : updated[index].name,
      };
      onChange(updated);
    },
    [stages, onChange]
  );

  const handleRemove = useCallback(
    (index: number) => {
      onChange(reorderWithPositions(stages.filter((_, i) => i !== index)));
    },
    [stages, onChange]
  );

  const handleReorder = useCallback(
    (reordered: FermentationStage[]) => onChange(reorderWithPositions(reordered)),
    [onChange]
  );

  const totalDays = stages.reduce((sum, stage) => sum + (stage.duration_days || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Fermentation Schedule</h3>
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={disabled}>
                Presets
                <ChevronDown className="ml-1 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {Object.entries(FERMENTATION_PRESETS).map(([key, preset]) => (
                <DropdownMenuItem
                  key={key}
                  onClick={() => handleApplyPreset(key as keyof typeof FERMENTATION_PRESETS)}
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
                Clear All Stages
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            size="sm"
            onClick={handleAddStage}
            disabled={disabled}
          >
            <Plus className="mr-1 h-4 w-4" />
            Add Stage
          </Button>
        </div>
      </div>

      {stages.length === 0 ? (
        <div className="border rounded-md p-8 text-center text-muted-foreground">
          <FlaskConical className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No fermentation stages defined yet.</p>
          <p className="text-sm mt-1">
            Select a preset or click &quot;Add Stage&quot; to build your fermentation schedule.
          </p>
        </div>
      ) : (
        <Sortable
          value={stages}
          onValueChange={handleReorder}
          getItemValue={(item) => item.id!}
        >
          <SortableContent asChild>
          <div className="space-y-2">
          {stages.map((stage, index) => (
            <SortableItem key={stage.id} value={stage.id!} asChild disabled={disabled}>
            <Collapsible>
              <div className="border rounded-lg">
                <div className="flex items-center gap-2 p-3">
                  <SortableItemHandle className="p-1 hover:bg-muted rounded touch-none">
                    <GripVertical className="h-4 w-4 text-muted-foreground" />
                  </SortableItemHandle>

                  {/* Stage Type */}
                  <Select
                    value={stage.stage}
                    onValueChange={(value) =>
                      handleStageTypeChange(index, value as FermentationStage["stage"])
                    }
                    disabled={disabled}
                  >
                    <SelectTrigger className="w-32">
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

                  {/* Stage Name */}
                  <Input
                    value={stage.name}
                    onChange={(e) => handleUpdateStage(index, "name", e.target.value)}
                    disabled={disabled}
                    className="flex-1 min-w-[120px]"
                    placeholder="Stage name"
                  />

                  {/* Temperature */}
                  <UnitInput
                    value={stage.temp_f}
                    onChange={(value) =>
                      handleUpdateStage(index, "temp_f", value ?? 0)
                    }
                    unitType="temperature"
                    decimals={0}
                    disabled={disabled}
                    wrapperClassName="w-28"
                  />

                  {/* Duration */}
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      step="1"
                      min="0"
                      value={stage.duration_days || ""}
                      onChange={(e) =>
                        handleUpdateStage(index, "duration_days", parseInt(e.target.value) || 0)
                      }
                      disabled={disabled}
                      className="w-14 text-right"
                    />
                    <span className="text-sm text-muted-foreground">days</span>
                  </div>

                  {/* Expand/Notes toggle */}
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 [&[data-state=open]>svg]:rotate-90">
                      <ChevronRight className="h-4 w-4 transition-transform" />
                    </Button>
                  </CollapsibleTrigger>

                  {/* Remove */}
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
                </div>

                {/* Notes Section */}
                <CollapsibleContent>
                  <div className="px-3 pb-3 pt-1 border-t">
                    <Textarea
                      placeholder="Notes (dry hop timing, temperature ramp instructions, etc.)"
                      value={stage.notes || ""}
                      onChange={(e) => handleUpdateStage(index, "notes", e.target.value)}
                      disabled={disabled}
                      className="min-h-[60px] text-sm"
                    />
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
            </SortableItem>
          ))}
          </div>
          </SortableContent>

          <div className="flex justify-between items-center border-t pt-3 text-sm mt-2">
            <span className="text-muted-foreground">
              {stages.length} stage{stages.length !== 1 ? "s" : ""}
            </span>
            <span className="font-medium">
              Total: {totalDays} days ({Math.round(totalDays / 7)} weeks)
            </span>
          </div>

          <SortableOverlay>
            {({ value }) => {
              const stage = stages.find((s) => s.id === value);
              return (
                <SortableDragPreview
                  title={stage?.name || "Stage"}
                  subtitle={stage ? `${formatTemperature(stage.temp_f, tempUnit, 0)} · ${stage.duration_days}d` : undefined}
                />
              );
            }}
          </SortableOverlay>
        </Sortable>
      )}
    </div>
  );
}
