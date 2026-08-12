/**
 * TTBReportCaveats
 *
 * The honesty notes that must sit under whichever TTB Form 5130.9 summary the
 * report page rendered:
 *
 *  1. the in-process note (`inProcessNote`) — how the in-process figure was
 *     measured. The `get_ttb_report` card passes `getInProcessBalanceNote`
 *     (period-end balances reconstructed from the batch audit trail, migration
 *     00287 / issue #618); the legacy batch-volume fallback passes
 *     `getLegacyInProcessSnapshotCaveat`, because its figure is still a live
 *     client-side snapshot;
 *  2. the accounting-identity disclosure — which tax classes were *not* checked,
 *     so a reader never assumes an unchecked column balanced;
 *  3. optionally, what the Total column covers (`getTotalScopeCaveat`, issue
 *     #670) — passed only by the by-tax-class card, since the legacy fallback
 *     summary has no Total column, and only when that helper returns a sentence
 *     (it returns null when no tax class in the report is scoped out).
 *
 * Extracted into a component because the page has two mutually exclusive
 * summary cards and both must carry an in-process explanation next to their
 * in-process line — before this existed only the first card carried one. The
 * note text is passed in rather than derived here because the two callers
 * measure in-process volume differently (see 1.); the wording for both lives
 * in `@/domain/ttb-utils`, like the disclosure text.
 */

export type TTBReportCaveatsProps = {
  /**
   * How this card's in-process figure was measured
   * (`getInProcessBalanceNote` or `getLegacyInProcessSnapshotCaveat`).
   */
  inProcessNote: string;
  /**
   * The "not accounting-identity checked" sentence, or `null` when every class
   * in the report was checked (then no disclosure line renders).
   */
  identityDisclosure: string | null;
  /**
   * What the Total column covers (`getTotalScopeCaveat`). Omit on a summary that
   * has no Total column — the legacy fallback card — or when the helper returned
   * null because nothing in the report is scoped out.
   */
  totalColumnCaveat?: string;
};

export function TTBReportCaveats({
  inProcessNote,
  identityDisclosure,
  totalColumnCaveat,
}: TTBReportCaveatsProps) {
  return (
    <>
      <p className="text-xs text-muted-foreground mt-3">{inProcessNote}</p>
      {identityDisclosure && (
        <p className="text-xs text-muted-foreground mt-2">{identityDisclosure}</p>
      )}
      {totalColumnCaveat && (
        <p className="text-xs text-muted-foreground mt-2">{totalColumnCaveat}</p>
      )}
    </>
  );
}
