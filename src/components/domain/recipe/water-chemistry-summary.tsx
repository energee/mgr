"use client";

/**
 * Water-chemistry salt calculator display for the recipe additions view:
 *
 * - WaterChemistrySummary — read-only table comparing source, target, and
 *   resulting ion concentrations (ppm) plus the sulfate:chloride ratio.
 * - CalculatedAdditionsSection — the calculated salt additions list with
 *   the "Apply to Recipe" button.
 *
 * All salt math lives in src/domain/water-chemistry.ts; these components
 * only render its outputs. The apply mutation itself stays in the
 * recipe-additions-display container.
 */

import { cn } from "@/lib/utils";
import {
  calculateSulfateChlorideRatio,
  formatRatio,
  getRatioDescription,
  SALT_ADDITIVE_MAP,
  WATER_IONS,
  type WaterProfile,
  type SaltAdditions,
} from "@/domain/water-chemistry";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useResolvedUnitPreferences } from "@/hooks/use-unit-preferences";
import { convertVolume, formatVolume } from "@/domain/units";
import { Loader2, Check } from "lucide-react";

/**
 * WaterChemistrySummary -- read-only table comparing source, target, and resulting
 * ion concentrations (ppm) plus the sulfate:chloride ratio.
 */
export function WaterChemistrySummary({
  source,
  target,
  targetName,
  resulting,
}: {
  source: WaterProfile & { name?: string };
  target: WaterProfile;
  targetName?: string;
  resulting: WaterProfile;
}) {
  const ratio = calculateSulfateChlorideRatio(
    resulting.sulfate_ppm,
    resulting.chloride_ppm
  );
  const ratioDesc = getRatioDescription(ratio);

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        Water Chemistry
      </h4>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-20" />
            {WATER_IONS.map((ion) => (
              <TableHead key={ion.key} className="text-center w-16">
                {ion.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="text-xs text-muted-foreground font-medium">
              Source
              {source.name && (
                <div className="text-[10px] font-normal truncate max-w-20">
                  {source.name}
                </div>
              )}
            </TableCell>
            {WATER_IONS.map((ion) => (
              <TableCell
                key={ion.key}
                className="text-center font-mono text-sm"
              >
                {Math.round(source[ion.key] ?? 0)}
              </TableCell>
            ))}
          </TableRow>
          <TableRow>
            <TableCell className="text-xs text-muted-foreground font-medium">
              Target
              {targetName && (
                <div className="text-[10px] font-normal truncate max-w-20">
                  {targetName}
                </div>
              )}
            </TableCell>
            {WATER_IONS.map((ion) => (
              <TableCell
                key={ion.key}
                className="text-center font-mono text-sm"
              >
                {Math.round(target[ion.key] ?? 0)}
              </TableCell>
            ))}
          </TableRow>
          <TableRow>
            <TableCell className="text-xs text-muted-foreground font-medium">
              Result
            </TableCell>
            {WATER_IONS.map((ion) => {
              const result = Math.round(resulting[ion.key]);
              const tgt = target[ion.key];
              const withinRange =
                tgt != null &&
                tgt > 0 &&
                Math.abs(result - tgt) / tgt <= 0.1;
              return (
                <TableCell
                  key={ion.key}
                  className={cn(
                    "text-center font-mono text-sm font-medium",
                    tgt != null &&
                      (withinRange
                        ? "text-green-600 dark:text-green-400"
                        : "text-amber-600 dark:text-amber-400")
                  )}
                >
                  {result}
                </TableCell>
              );
            })}
          </TableRow>
        </TableBody>
      </Table>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">SO&#x2084;:Cl Ratio:</span>
        <span className="font-mono font-medium">{formatRatio(ratio)}</span>
        <Badge variant="outline">{ratioDesc.label}</Badge>
      </div>
    </div>
  );
}

/** Calculated salt additions with "Apply to Recipe" button (exported for characterization tests) */
export function CalculatedAdditionsSection({
  additions,
  onApply,
  isApplying,
  applySuccess,
  totalVolumeGal,
}: {
  additions: SaltAdditions;
  onApply: () => void;
  isApplying: boolean;
  applySuccess: boolean;
  totalVolumeGal: number;
}) {
  const nonZeroSalts = Object.entries(SALT_ADDITIVE_MAP).filter(
    ([key]) => additions[key as keyof SaltAdditions] > 0
  );

  const volumeUnit = useResolvedUnitPreferences().volume_unit;

  if (nonZeroSalts.length === 0) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Calculated Salt Additions
          <span className="text-xs font-normal normal-case ml-2">
            ({formatVolume(convertVolume(totalVolumeGal, "gal", "bbl"), volumeUnit, 1)} total water)
          </span>
        </h4>
        <Button
          variant="outline"
          size="sm"
          onClick={onApply}
          disabled={isApplying}
          className="gap-1"
        >
          {isApplying ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : applySuccess ? (
            <Check className="h-3 w-3" />
          ) : null}
          {applySuccess ? "Applied" : "Apply to Recipe"}
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Salt</TableHead>
            <TableHead className="w-28 text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {nonZeroSalts.map(([key, name]) => (
            <TableRow key={key}>
              <TableCell className="font-medium">{name}</TableCell>
              <TableCell className="text-right font-mono">
                {additions[key as keyof SaltAdditions].toFixed(1)} g
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
