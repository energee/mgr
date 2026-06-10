/**
 * Transition Side Effects
 *
 * Central registry of side effects that must run after an entity state
 * transition succeeds, regardless of which UI path performed the UPDATE
 * (list-row action, kanban drag, mobile card menu, bulk action bar, detail
 * page dropdown, or a custom page handler). Before this module existed the
 * batch-completion effect was duplicated in only 2 of the 4 transition
 * paths, so completing a batch from the bulk bar or the generic detail
 * dropdown silently skipped ingredient consumption.
 *
 * Adding a new side effect: extend the registry switch in
 * `runTransitionSideEffects` with a `(table, toState)` match and document
 * what the effect does. Effects must be idempotent — multiple UI paths can
 * race (e.g. completeBatchConsumption flips planned→completed allocations,
 * so a second call matches 0 rows and is a harmless no-op).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { completeBatchConsumption } from "./consumption-service";
import { formatServiceError } from "./types";

type Client = SupabaseClient<Database>;

/** Outcome of running all side effects registered for a transition. */
export type TransitionSideEffectResult = {
  /** User-facing error message when a side effect failed; null when clean. */
  error: string | null;
  /**
   * Number of ingredient allocations confirmed. Only populated by the
   * `batches → completed` entry (callers may use it for a success toast).
   */
  completedAllocations: number;
};

/**
 * Run the side effects registered for transitioning `ids` in `table` to
 * `toState`. Call this AFTER the state UPDATE has succeeded, passing only
 * the ids that actually transitioned. Never throws — failures are collected
 * into `result.error` as a toast-ready message.
 */
export async function runTransitionSideEffects(
  supabase: Client,
  table: string,
  ids: string[],
  toState: string
): Promise<TransitionSideEffectResult> {
  const result: TransitionSideEffectResult = { error: null, completedAllocations: 0 };

  // Registry — one entry per (table, toState) pair with side effects.
  //
  // batches → completed: flip the batch's planned brew-day ingredient
  // allocations (inventory_lot → batch) to completed so inventory is
  // actually depleted (audit Batch 9). Idempotent: re-running matches 0
  // planned rows.
  if (table === "batches" && toState === "completed") {
    const failures: string[] = [];
    for (const id of ids) {
      const res = await completeBatchConsumption(supabase, id);
      if (res.success) {
        result.completedAllocations += res.data;
      } else {
        failures.push(formatServiceError(res.error));
      }
    }
    if (failures.length > 0) {
      result.error = `Batch completed, but confirming ingredient consumption failed: ${[...new Set(failures)].join("; ")}`;
    }
  }

  return result;
}
