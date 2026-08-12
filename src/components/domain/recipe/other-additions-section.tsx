"use client";

/**
 * OtherAdditionsSection — non-water recipe additions (clarifiers,
 * nutrients, antifoam, etc.) grouped by brewing-process timing, each group
 * rendered with the shared AdditionsTable. Pure: no hooks, no data
 * fetching.
 */

import { Badge } from "@/components/ui/badge";
import { AdditionsTable } from "./additions-table";
import { TIMING_LABELS, type AdditionRow } from "./addition-labels";

/** Other additions section -- clarifiers, nutrients, etc. (exported for characterization tests) */
export function OtherAdditionsSection({
  additions,
}: {
  additions: AdditionRow[];
}) {
  const groupedByTiming = additions.reduce(
    (acc, addition) => {
      const timing = addition.timing;
      if (!acc[timing]) acc[timing] = [];
      acc[timing].push(addition);
      return acc;
    },
    {} as Record<string, AdditionRow[]>
  );

  return (
    <div>
      <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
        Other Additions
      </h4>
      {Object.entries(groupedByTiming).map(([timing, items]) => (
        <div key={timing} className="mb-3">
          <div className="text-sm font-medium mb-1 flex items-center gap-2">
            <Badge variant="outline">{TIMING_LABELS[timing] || timing}</Badge>
            <span className="text-muted-foreground text-xs">
              ({items.length} {items.length === 1 ? "addition" : "additions"})
            </span>
          </div>
          <AdditionsTable additions={items} showTarget={timing === "mash" || timing === "sparge"} />
        </div>
      ))}
    </div>
  );
}
