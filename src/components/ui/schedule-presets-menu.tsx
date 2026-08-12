"use client";

/**
 * SchedulePresetsMenu — the "Presets" dropdown shared by the mash and
 * fermentation schedule editors.
 *
 * Both rendered the same menu: one item per preset (bold name over a muted
 * description), a separator, and a destructive "Clear All …" item. The preset
 * map's value shape is the only thing that varies, so it is generic over
 * anything carrying `name` and `description`.
 */

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";

type Preset = { name: string; description: string };

export function SchedulePresetsMenu<K extends string>({
  presets,
  onApply,
  onClear,
  clearLabel,
  disabled = false,
}: {
  presets: Record<K, Preset>;
  onApply: (key: K) => void;
  onClear: () => void;
  /** Text for the destructive item, e.g. "Clear All Steps". */
  clearLabel: string;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          Presets
          <ChevronDown className="ml-1 h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {(Object.entries(presets) as [K, Preset][]).map(([key, preset]) => (
          <DropdownMenuItem key={key} onClick={() => onApply(key)}>
            <div className="flex flex-col">
              <span className="font-medium">{preset.name}</span>
              <span className="text-xs text-muted-foreground">{preset.description}</span>
            </div>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onClear} className="text-destructive">
          {clearLabel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
