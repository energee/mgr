/**
 * Pure math/validation for the packaging session revision flow
 * (audit finding C2 — RevisePackagingSession dialog).
 *
 * The dialog keeps the user's per-line drafts as raw strings (so typing is
 * never reformatted mid-keystroke); this module turns those drafts into the
 * payload for the revise_packaging_session RPC (migration 00184):
 * validating each entry (non-negative whole numbers), computing per-line
 * deltas for display, and emitting only the lines that actually changed.
 */

/** The line-item fields the revision math needs. */
export type RevisableLineItem = {
  id: string;
  actual_quantity: number | null;
};

/** One entry of the revise_packaging_session p_items payload. */
export type ReviseItemPayload = {
  line_item_id: string;
  actual_quantity: number | null;
};

export type ReviseDraftState = {
  /** RPC payload — only the lines whose actual changed. */
  changed: ReviseItemPayload[];
  /** Per-line delta (new - old, both null-coalesced to 0) for display. */
  deltaByLine: Map<string, number>;
  /** Per-line validation error, keyed by line item id. */
  errorByLine: Map<string, string>;
};

/**
 * Parse a single draft string into a quantity for the RPC.
 * Returns `{ value }` (null = cleared) or `{ error }` for invalid entries.
 */
export function parseReviseDraft(
  raw: string
): { value: number | null; error?: undefined } | { error: string; value?: undefined } {
  const trimmed = raw.trim();
  if (trimmed === "") return { value: null };
  // Strict Number semantics (same rules as parseEditableNumber in
  // src/hooks/use-numeric-input.ts, inlined to keep the domain layer free of
  // hook imports): trailing garbage ("5x") and in-progress strings ("-", ".")
  // are rejected rather than silently truncated.
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return { error: "Not a number" };
  if (parsed < 0) return { error: "Must be ≥ 0" };
  if (!Number.isInteger(parsed)) return { error: "Whole units only" };
  return { value: parsed };
}

/**
 * Evaluate all drafts against the current line items: build the RPC payload
 * (changed lines only), per-line deltas, and per-line validation errors.
 * A missing draft entry means "untouched" and is treated as unchanged.
 */
export function evaluateReviseDrafts(
  items: RevisableLineItem[],
  drafts: Record<string, string>
): ReviseDraftState {
  const changed: ReviseItemPayload[] = [];
  const deltaByLine = new Map<string, number>();
  const errorByLine = new Map<string, string>();

  for (const item of items) {
    const raw = drafts[item.id];
    if (raw === undefined) continue;

    const result = parseReviseDraft(raw);
    if (result.error !== undefined) {
      errorByLine.set(item.id, result.error);
      continue;
    }

    const next = result.value;
    if (next === item.actual_quantity) continue; // unchanged (incl. null === null)

    deltaByLine.set(item.id, (next ?? 0) - (item.actual_quantity ?? 0));
    changed.push({ line_item_id: item.id, actual_quantity: next });
  }

  return { changed, deltaByLine, errorByLine };
}
