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
import type { QueryClient } from "@tanstack/react-query";
import type { Database } from "@/types/supabase";
import { entityKeys } from "@/lib/query-keys";
import {
  completeBatchConsumption,
  consumePackagingMaterials,
  reconcileBatchLoss,
} from "./consumption-service";
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
  /**
   * Volume (bbl) auto-recorded as completion loss reconciliation — produced
   * wort minus packaged minus attributed removals. Only populated by the
   * `batches → completed` entry.
   */
  reconciledLossBbl: number;
};

/**
 * Run the side effects registered for transitioning `ids` in `table` to
 * `toState`. Call this AFTER the state UPDATE has succeeded, passing only
 * the ids that actually transitioned. Never throws — failures are collected
 * into `result.error` as a toast-ready message.
 *
 * `queryClient` is optional: side effects that mutate a DIFFERENT table than
 * the one being transitioned (e.g. pick_lists → orders status sync) use it to
 * invalidate the other table's caches so its pages don't show a stale status
 * for the 2-minute default staleTime. Callers that don't pass it still get
 * the database writes; the cross-entity caches refresh on the next refetch.
 */
export async function runTransitionSideEffects(
  supabase: Client,
  table: string,
  ids: string[],
  toState: string,
  queryClient?: QueryClient
): Promise<TransitionSideEffectResult> {
  const result: TransitionSideEffectResult = {
    error: null,
    completedAllocations: 0,
    reconciledLossBbl: 0,
  };

  // Registry — one entry per (table, toState) pair with side effects.
  //
  // batches → completed:
  // 1. Flip the batch's planned brew-day ingredient allocations
  //    (inventory_lot → batch) to completed so inventory is actually
  //    depleted (audit Batch 9). Idempotent: re-running matches 0 rows.
  // 2. Reconcile total loss anchored to packaged-vs-produced-wort: produced
  //    volume neither packaged nor already attributed is auto-recorded as a
  //    'reconciliation' loss allocation (feeds the TTB losses line).
  //    Idempotent via the reconciliation note guard; skips while any of the
  //    batch's packaging sessions is still open.
  if (table === "batches" && toState === "completed") {
    const consumptionFailures: string[] = [];
    const reconcileFailures: string[] = [];
    for (const id of ids) {
      const res = await completeBatchConsumption(supabase, id);
      if (res.success) {
        result.completedAllocations += res.data;
      } else {
        consumptionFailures.push(formatServiceError(res.error));
      }
      const rec = await reconcileBatchLoss(supabase, id);
      if (rec.success) {
        result.reconciledLossBbl += rec.data;
      } else {
        reconcileFailures.push(formatServiceError(rec.error));
      }
    }
    const parts: string[] = [];
    if (consumptionFailures.length > 0) {
      parts.push(
        `confirming ingredient consumption failed: ${[...new Set(consumptionFailures)].join("; ")}`
      );
    }
    if (reconcileFailures.length > 0) {
      parts.push(`loss reconciliation failed: ${[...new Set(reconcileFailures)].join("; ")}`);
    }
    if (parts.length > 0) {
      result.error = `Batch completed, but ${parts.join("; ")}`;
    }
    if (result.reconciledLossBbl > 0) {
      // New loss allocations affect the allocations list and TTB report.
      void queryClient?.invalidateQueries({ queryKey: entityKeys.all("allocations") });
    }
  }

  // packaging_sessions → completed: consume the session's packaging-material
  // BOM from inventory lots. The completion dialog also calls
  // consumePackagingMaterials directly; the service's session-note guard
  // makes whichever call runs second a no-op, so both paths are safe. (The
  // dialog additionally prompts for loss capture — that part is interactive
  // and intentionally does not run from generic transition paths.)
  if (table === "packaging_sessions" && toState === "completed") {
    const failures: string[] = [];
    for (const id of ids) {
      const res = await consumePackagingMaterials(supabase, id);
      if (!res.success) failures.push(formatServiceError(res.error));
    }
    if (failures.length > 0) {
      result.error = `Session completed, but material depletion failed: ${[...new Set(failures)].join("; ")}`;
    }
  }

  // pick_lists → in_progress / completed: keep the parent order's status in
  // step with picking work (audit S3 — previously the same fact had to be
  // entered twice). Starting a pick list moves its order scheduled → picking;
  // completing one moves it picking → packed. Both UPDATEs are status-guarded
  // (.eq) so they are idempotent AND can never trip the server-side
  // transition validator (migration 00143): e.g. a pick list generated while
  // the order is still "confirmed" (order-quick-links allows this) matches 0
  // rows — a harmless no-op instead of a confirmed → picking check_violation.
  // order_id is looked up from the pick_lists rows because the registry only
  // receives ids.
  if (table === "pick_lists" && (toState === "in_progress" || toState === "completed")) {
    const sync =
      toState === "in_progress"
        ? { from: "scheduled", to: "picking" }
        : { from: "picking", to: "packed" };

    const { data: lists, error: fetchError } = await supabase
      .from("pick_lists")
      .select("order_id")
      .in("id", ids);

    if (fetchError) {
      result.error = `Pick list updated, but syncing the order status failed: ${fetchError.message}`;
    } else {
      const orderIds = [...new Set((lists ?? []).map((l) => l.order_id).filter(Boolean))];
      if (orderIds.length > 0) {
        const { error: updateError } = await supabase
          .from("orders")
          .update({ status: sync.to })
          .in("id", orderIds)
          .eq("status", sync.from);

        if (updateError) {
          result.error = `Pick list updated, but syncing the order status failed: ${updateError.message}`;
        } else {
          // Orders were (possibly) touched — refresh their caches so list and
          // detail pages reflect the synced status immediately.
          void queryClient?.invalidateQueries({ queryKey: entityKeys.all("orders") });
        }
      }
    }
  }

  return result;
}
