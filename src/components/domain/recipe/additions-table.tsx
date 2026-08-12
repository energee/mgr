"use client";

/**
 * AdditionsTable — shared read-only table for recipe_additions rows
 * (additive name/description, type badge, amount, optional Target column).
 * Used by the applied-water-treatment section in recipe-additions-display
 * and by other-additions-section. Pure: no hooks, no data fetching.
 */

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  WATER_CHEMISTRY_TYPES,
  TARGET_LABELS,
  TYPE_LABELS,
  TYPE_COLORS,
  type AdditionRow,
} from "./addition-labels";

/** Shared table for displaying addition rows (exported for characterization tests) */
export function AdditionsTable({
  additions,
  showTarget,
}: {
  additions: AdditionRow[];
  showTarget?: boolean;
}) {
  const hasTargets =
    showTarget ??
    additions.some((a) =>
      WATER_CHEMISTRY_TYPES.includes(a.additive?.type || "")
    );

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Additive</TableHead>
          <TableHead className="w-24">Type</TableHead>
          <TableHead className="w-28 text-right">Amount</TableHead>
          {hasTargets && <TableHead className="w-28">Target</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {additions.map((addition) => (
          <TableRow key={addition.id}>
            <TableCell>
              <div>
                <span className="font-medium">
                  {addition.additive?.name || "Unknown"}
                </span>
                {addition.additive?.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {addition.additive.description}
                  </p>
                )}
              </div>
            </TableCell>
            <TableCell>
              <Badge
                variant="secondary"
                className={TYPE_COLORS[addition.additive?.type || "other"]}
              >
                {TYPE_LABELS[addition.additive?.type || "other"]}
              </Badge>
            </TableCell>
            <TableCell className="text-right font-mono">
              {addition.amount} {addition.unit}
            </TableCell>
            {hasTargets && (
              <TableCell>
                {addition.target
                  ? TARGET_LABELS[addition.target] || addition.target
                  : "\u2014"}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
