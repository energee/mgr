/**
 * TTBReportCaveats
 *
 * The two honesty notes that must sit under whichever TTB Form 5130.9 summary
 * the report page rendered:
 *
 *  1. the in-process snapshot caveat (`getInProcessSnapshotCaveat`) — the
 *     in-process figures are a live sum of batches fermenting/conditioning/
 *     packaging right now, not a period-end balance (issue #618);
 *  2. the accounting-identity disclosure — which tax classes were *not* checked,
 *     so a reader never assumes an unchecked column balanced.
 *
 * Extracted into a component because the page has two mutually exclusive
 * summary cards — the `get_ttb_report` table and the legacy batch-volume
 * fallback — and both label their in-process line "In Process (Current
 * Snapshot)". Before this existed only the first card carried the explanation,
 * so the fallback showed the honest label with none of the honest caveat.
 *
 * The disclosure text is passed in rather than derived here: the two callers
 * disclose different things (per-tax-class exemptions vs. "no checks ran at all
 * in this fallback"), and the wording for both lives in `@/domain/ttb-utils`.
 */

import { getInProcessSnapshotCaveat } from "@/domain/ttb-utils";

export type TTBReportCaveatsProps = {
  /** Human period the report covers, e.g. `"June 2026"`. */
  periodLabel: string;
  /**
   * The "not accounting-identity checked" sentence, or `null` when every class
   * in the report was checked (then no disclosure line renders).
   */
  identityDisclosure: string | null;
};

export function TTBReportCaveats({ periodLabel, identityDisclosure }: TTBReportCaveatsProps) {
  return (
    <>
      <p className="text-xs text-muted-foreground mt-3">
        {getInProcessSnapshotCaveat(periodLabel)}
      </p>
      {identityDisclosure && (
        <p className="text-xs text-muted-foreground mt-2">{identityDisclosure}</p>
      )}
    </>
  );
}
