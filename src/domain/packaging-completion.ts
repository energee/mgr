/**
 * Packaging Completion Follow-up (audit Q4, findings 14 + 20)
 *
 * Pure domain math behind the post-completion source-batch prompts shown
 * after a packaging session is completed:
 *
 * - `packagingBatchCandidates` dedupes a session's line items to the distinct
 *   source batches still in "packaging" status (the only ones worth offering
 *   a Complete for — batches can be packaged across multiple sessions, so
 *   completion stays opt-in per batch).
 * - `latestGravitySg` picks the most recent gravity reading (by effective
 *   time, honouring backdated entries) and converts it to specific gravity
 *   (readings canonicalise to Plato; `batches.actual_fg` stores SG).
 * - `suggestFgAbv` builds the actual_fg / actual_abv column suggestion from
 *   that reading plus the brew-derived actual_og, never overwriting values
 *   already set on the batch.
 *
 * Kept free of Supabase/React so the logic is unit-testable
 * (`__tests__/packaging-completion.test.ts`).
 */

import { platoToSg } from "@/domain/units";
import {
  readingLogTime,
  type ReadingLogLike,
} from "@/domain/batch-reading-log";

// =============================================================================
// Candidate batches
// =============================================================================

/** Minimal shape of a session line item joined to its source batch. */
export type SourceBatchRow = {
  batch_id: string | null;
  batch: {
    batch_code: string | null;
    status: string | null;
    actual_fg: number | null;
    actual_abv: number | null;
  } | null;
};

/** One distinct source batch eligible for a post-completion prompt. */
export type SourceBatchCandidate = {
  batchId: string;
  batchCode: string;
  actualFg: number | null;
  actualAbv: number | null;
};

/**
 * Dedupe session line items to the distinct source batches still in
 * "packaging" status. Line items without a batch are skipped; the first
 * row wins for duplicate batch ids (they join the same batch row anyway).
 */
export function packagingBatchCandidates(
  rows: SourceBatchRow[]
): SourceBatchCandidate[] {
  const seen = new Set<string>();
  const candidates: SourceBatchCandidate[] = [];
  for (const row of rows) {
    if (!row.batch_id || seen.has(row.batch_id)) continue;
    seen.add(row.batch_id);
    if (row.batch?.status !== "packaging") continue;
    candidates.push({
      batchId: row.batch_id,
      batchCode: row.batch.batch_code ?? row.batch_id.slice(0, 8),
      actualFg: row.batch.actual_fg ?? null,
      actualAbv: row.batch.actual_abv ?? null,
    });
  }
  return candidates;
}

// =============================================================================
// FG / ABV suggestion
// =============================================================================

/** Reading log row shape needed to extract the latest gravity value. */
export type GravityLogLike = ReadingLogLike & {
  data: {
    reading_type?: string;
    value?: number | string;
    unit?: string;
    timestamp?: string;
  };
};

/** Plausible final-gravity window (SG); guards against junk readings. */
const MIN_PLAUSIBLE_SG = 0.98;
const MAX_PLAUSIBLE_SG = 1.2;

/**
 * Latest gravity reading from a batch's measurement logs, converted to
 * specific gravity and rounded to 3 decimals. Readings store Plato
 * canonically (CANONICAL_UNIT_MAP in batch-reading-form), so anything not
 * explicitly unit "sg" is treated as Plato. Uses effective reading time
 * (user-entered timestamp, falling back to created_at) so a backdated
 * reading doesn't masquerade as the latest. Returns null when there is no
 * usable gravity reading or the value is outside the plausible SG window.
 */
export function latestGravitySg(logs: GravityLogLike[]): number | null {
  const gravity = logs
    .filter((log) => log.data?.reading_type === "gravity")
    .sort((a, b) => readingLogTime(b) - readingLogTime(a));
  const latest = gravity[0];
  if (!latest) return null;

  const raw = Number(latest.data.value);
  if (!Number.isFinite(raw)) return null;

  const sg = latest.data.unit === "sg" ? raw : platoToSg(raw);
  if (sg < MIN_PLAUSIBLE_SG || sg > MAX_PLAUSIBLE_SG) return null;
  return Math.round(sg * 1000) / 1000;
}

/** Column patch for the guarded batch-completion UPDATE. */
export type FgAbvSuggestion = {
  actual_fg?: number;
  actual_abv?: number;
};

/**
 * Suggest actual_fg / actual_abv for a batch being completed (finding 20):
 *
 * - actual_fg: the latest gravity reading as SG — only when the batch has no
 *   actual_fg yet (these columns have no entry UI, so they are almost always
 *   null, but never clobber a value that exists).
 * - actual_abv: standard (OG − FG) × 131.25, from the brew-derived actual_og
 *   (batches_with_brew_info view) and whichever FG applies (existing or
 *   suggested) — only when actual_abv is unset and the result is positive.
 *
 * Returns an empty object when there is nothing to suggest.
 */
export function suggestFgAbv(params: {
  latestSg: number | null;
  actualOg: number | null;
  existingFg: number | null;
  existingAbv: number | null;
}): FgAbvSuggestion {
  const { latestSg, actualOg, existingFg, existingAbv } = params;
  const suggestion: FgAbvSuggestion = {};

  const fg = existingFg ?? latestSg;
  if (existingFg == null && latestSg != null) {
    suggestion.actual_fg = latestSg;
  }

  if (existingAbv == null && actualOg != null && fg != null && actualOg > fg) {
    const abv = Math.round((actualOg - fg) * 131.25 * 10) / 10;
    if (Number.isFinite(abv) && abv > 0) {
      suggestion.actual_abv = abv;
    }
  }

  return suggestion;
}
