"use client";

/**
 * RecipeScheduleDisplay - Display component for recipe mash and fermentation schedules
 *
 * Read-only display of mash steps and fermentation stages for the recipe detail view.
 * Uses the same type definitions as the editor components.
 */

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
import { Thermometer, FlaskConical } from "lucide-react";
import { UnitDisplay } from "@/components/ui/unit-input";
import type { MashStep } from "./mash-schedule-editor";
import type { FermentationStage } from "./fermentation-schedule-editor";

/** Domain constants: mash step type labels (not entity status -- no stateMachine applies). */
const STEP_TYPE_LABELS: Record<string, string> = {
  infusion: "Infusion",
  decoction: "Decoction",
  direct_heat: "Direct Heat",
  rest: "Rest",
};

/** Domain constants: fermentation stage type labels (not entity status -- no stateMachine applies). */
const STAGE_TYPE_LABELS: Record<string, string> = {
  primary: "Primary",
  secondary: "Secondary",
  diacetyl_rest: "Diacetyl Rest",
  cold_crash: "Cold Crash",
  conditioning: "Conditioning",
  lagering: "Lagering",
  custom: "Custom",
};

type MashScheduleDisplayProps = {
  data: { mash_schedule?: MashStep[] | unknown };
}

type FermentationScheduleDisplayProps = {
  data: { fermentation_schedule?: FermentationStage[] | unknown };
}

/**
 * Display component for mash schedule - used in recipe detail view
 */
export function MashScheduleDisplay({ data }: MashScheduleDisplayProps) {
  const steps = (data.mash_schedule || []) as MashStep[];

  if (steps.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-6">
        <Thermometer className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p>No mash schedule defined</p>
      </div>
    );
  }

  const totalTime = steps.reduce((sum, step) => sum + (step.duration_min || 0), 0);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8">#</TableHead>
          <TableHead className="w-28">Type</TableHead>
          <TableHead>Step Name</TableHead>
          <TableHead className="w-24 text-right">Temp</TableHead>
          <TableHead className="w-24 text-right">Duration</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {steps.map((step, index) => (
          <TableRow key={step.id || index}>
            <TableCell className="text-muted-foreground">{index + 1}</TableCell>
            <TableCell>
              <Badge variant="outline">
                {STEP_TYPE_LABELS[step.step_type] || step.step_type}
              </Badge>
            </TableCell>
            <TableCell className="font-medium">{step.name}</TableCell>
            <TableCell className="text-right"><UnitDisplay value={step.temp_f} unitType="temperature" decimals={1} /></TableCell>
            <TableCell className="text-right">{step.duration_min} min</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={4} className="font-medium">
            Total Mash Time
          </TableCell>
          <TableCell className="text-right font-medium">
            {totalTime} min
          </TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}

/**
 * Display component for fermentation schedule - used in recipe detail view
 */
export function FermentationScheduleDisplay({ data }: FermentationScheduleDisplayProps) {
  const stages = (data.fermentation_schedule || []) as FermentationStage[];

  if (stages.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-6">
        <FlaskConical className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p>No fermentation schedule defined</p>
      </div>
    );
  }

  const totalDays = stages.reduce((sum, stage) => sum + (stage.duration_days || 0), 0);

  return (
    <div className="space-y-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">#</TableHead>
            <TableHead className="w-32">Stage</TableHead>
            <TableHead>Name</TableHead>
            <TableHead className="w-24 text-right">Temp</TableHead>
            <TableHead className="w-24 text-right">Duration</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {stages.map((stage, index) => (
            <TableRow key={stage.id || index}>
              <TableCell className="text-muted-foreground">{index + 1}</TableCell>
              <TableCell>
                <Badge variant="outline">
                  {STAGE_TYPE_LABELS[stage.stage] || stage.stage}
                </Badge>
              </TableCell>
              <TableCell>
                <div>
                  <span className="font-medium">{stage.name}</span>
                  {stage.notes && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {stage.notes}
                    </p>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-right"><UnitDisplay value={stage.temp_f} unitType="temperature" decimals={1} /></TableCell>
              <TableCell className="text-right">{stage.duration_days} days</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={4} className="font-medium">
              Total Fermentation Time
            </TableCell>
            <TableCell className="text-right font-medium">
              {totalDays} days ({Math.round(totalDays / 7)} weeks)
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}
