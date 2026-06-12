/**
 * Batch Reading Log Ordering
 *
 * Helpers for ordering fermentation reading logs (batch_logs rows with
 * log_type "measurement") by their *effective* time: the user-entered
 * `data.timestamp` (readings can be backdated) falling back to the row's
 * `created_at`. Without this, a reading entered late sorts out of order and
 * can masquerade as the "current" value in latest-by-type summaries.
 */

/** Minimal structural shape of a batch_logs reading row needed for ordering */
export type ReadingLogLike = {
  created_at: string;
  data: { timestamp?: string };
};

/**
 * Effective time of a reading log in epoch milliseconds.
 *
 * Prefers the user-entered `data.timestamp` (datetime-local string, parsed in
 * the local timezone); falls back to `created_at` when the timestamp is
 * missing or unparseable.
 */
export function readingLogTime(log: ReadingLogLike): number {
  const ts = log.data?.timestamp;
  if (ts) {
    const t = new Date(ts).getTime();
    if (!Number.isNaN(t)) return t;
  }
  return new Date(log.created_at).getTime();
}

/**
 * Sort reading logs newest-first by effective time (see {@link readingLogTime}).
 * Returns a new array; the input is not mutated.
 */
export function sortReadingLogsByTimestampDesc<T extends ReadingLogLike>(
  logs: T[]
): T[] {
  return [...logs].sort((a, b) => readingLogTime(b) - readingLogTime(a));
}
