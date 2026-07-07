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
 * Covered (table, toState) pairs:
 * - batches → completed: ingredient consumption, loss reconciliation, vessel release
 * - packaging_sessions → completed: packaging-material BOM depletion
 * - pick_lists → in_progress / completed: parent order status sync
 * - orders → fulfilled: complete FG→order reservations + stamp TTB removal volume
 * - orders → cancelled: release still-planned FG→order reservations
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
import { entityKeys, inventoryKeys, orderKeys } from "@/lib/query-keys";
import { computeUnitFillVolumeBbl } from "@/domain/consumption-planning";
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
  // 3. Release the batches' vessels (empty + dirty, same semantics as the
  //    cancel/archive RPCs, 00042/00069). Without this a batch completed in
  //    a brite tank occupied it forever, hiding the tank from every transfer
  //    destination list. Idempotent: re-running matches 0 rows.
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
    const { error: vesselError } = await supabase
      .from("vessels")
      .update({ status: "dirty", current_batch_id: null, updated_at: new Date().toISOString() })
      .in("current_batch_id", ids);
    if (!vesselError) {
      void queryClient?.invalidateQueries({ queryKey: entityKeys.all("vessels") });
      void queryClient?.invalidateQueries({ queryKey: entityKeys.all("vessels_with_batch") });
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
    if (vesselError) {
      parts.push(`releasing the vessel failed: ${vesselError.message}`);
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

  // orders → fulfilled: complete the orders' still-planned finished-goods
  // reservations (allocations finished_good → order, inserted `planned` by
  // the allocation dialog and generate_pick_list), stamping completed_at and
  // the removed volume in bbl — allocation quantity × per-unit fill of the
  // source finished good (FG → selling_format → container, via
  // computeUnitFillVolumeBbl). Completed removal volume is what the TTB
  // report counts as "removed for sale"; before this entry existed the
  // reservations stayed planned forever and TTB removals were permanently
  // zero (audit H1).
  //
  // Deliberately ledger-only stock: finished_goods.quantity is NEVER
  // decremented here. quantity records what was packaged; the availability
  // views derive available stock as quantity − planned/completed allocations
  // (00010), so decrementing on fulfillment would double-count the removal,
  // and TTB ending inventory derives as production − removals. See
  // docs/knowledge/entity-model.md ("finished goods stock is ledger-style").
  //
  // Idempotent: every UPDATE is guarded on status='planned' (same pattern as
  // completeBatchConsumption) — a racing second path matches 0 rows. Volume
  // is written in the same UPDATE as the status flip so no completed row
  // ever transiently lacks its volume. Reservations whose finished good has
  // no usable container volume are still completed (the shipment already
  // physically happened — same philosophy as consumePackagingMaterials'
  // shortfall reporting) with volume_bbl NULL and a non-fatal warning.
  if (table === "orders" && toState === "fulfilled") {
    const { data: planned, error: readError } = await supabase
      .from("allocations")
      .select("id, source_id, quantity")
      .eq("destination_type", "order")
      .in("destination_id", ids)
      .eq("source_type", "finished_good")
      .eq("status", "planned");

    if (readError) {
      result.error = `Order fulfilled, but completing its inventory reservations failed: ${readError.message}`;
    } else if ((planned ?? []).length > 0) {
      const rows = planned ?? [];

      // Per-unit fill volume per source finished good.
      const fgIds = [...new Set(rows.map((r) => r.source_id).filter((id): id is string => !!id))];
      const unitFillByFg = new Map<string, number>();
      let volumeLookupError: string | null = null;
      if (fgIds.length > 0) {
        const { data: fgs, error: fgError } = await supabase
          .from("finished_goods")
          .select(
            "id, selling_format:selling_formats(unit_count, container:containers(volume_bbl, volume_oz))"
          )
          .in("id", fgIds);
        if (fgError) {
          volumeLookupError = fgError.message;
        } else {
          type FinishedGoodVolumeRow = {
            id: string;
            selling_format: {
              unit_count: number | null;
              container: { volume_bbl: number | null; volume_oz: number | null } | null;
            } | null;
          };
          for (const fg of (fgs ?? []) as unknown as FinishedGoodVolumeRow[]) {
            const unitVol = fg.selling_format
              ? computeUnitFillVolumeBbl(fg.selling_format)
              : null;
            if (unitVol != null) unitFillByFg.set(fg.id, unitVol);
          }
        }
      }

      const completedAt = new Date().toISOString();
      let missingVolume = 0;
      const updateFailures: string[] = [];
      for (const row of rows) {
        const unitVol = row.source_id ? unitFillByFg.get(row.source_id) : undefined;
        const volumeBbl = unitVol != null ? Number(row.quantity) * unitVol : null;
        if (volumeBbl == null) missingVolume += 1;
        const { error: updateError } = await supabase
          .from("allocations")
          .update({ status: "completed", completed_at: completedAt, volume_bbl: volumeBbl })
          .eq("id", row.id)
          .eq("status", "planned");
        if (updateError) updateFailures.push(updateError.message);
      }

      const parts: string[] = [];
      if (updateFailures.length > 0) {
        parts.push(
          `completing ${updateFailures.length} reservation(s) failed: ${[...new Set(updateFailures)].join("; ")}`
        );
      }
      if (volumeLookupError) {
        parts.push(
          `looking up container volumes failed (${volumeLookupError}) — reservations were completed without volume, so TTB removals will under-report`
        );
      } else if (missingVolume > 0) {
        parts.push(
          `${missingVolume} reservation(s) have no container volume data and were completed without volume — TTB removals will under-report until the container volume is backfilled`
        );
      }
      if (parts.length > 0) {
        result.error = `Order fulfilled, but ${parts.join("; ")}`;
      }

      // Completed removals feed the allocations list, TTB report, and each
      // order's allocation panel. (entityKeys.all("allocations") is the same
      // ["allocations"] root inventoryKeys.allocations() returns.)
      void queryClient?.invalidateQueries({ queryKey: entityKeys.all("allocations") });
      for (const orderId of ids) {
        void queryClient?.invalidateQueries({ queryKey: orderKeys.allocations(orderId) });
      }
    }
  }

  // orders → cancelled: release the orders' still-planned finished-goods
  // reservations so the reserved stock becomes available again (audit M12 —
  // the UI blocks editing allocations once the order is cancelled, so a
  // leaked planned reservation was unfixable from the app). Completed
  // allocations are untouched: volume already removed for a partially
  // shipped order stays removed. Single status-guarded UPDATE → idempotent,
  // and the allocations server-side state machine (00143) allows
  // planned → cancelled.
  if (table === "orders" && toState === "cancelled") {
    const { error: releaseError } = await supabase
      .from("allocations")
      .update({ status: "cancelled" })
      .eq("destination_type", "order")
      .in("destination_id", ids)
      .eq("source_type", "finished_good")
      .eq("status", "planned");

    if (releaseError) {
      result.error = `Order cancelled, but releasing its inventory reservations failed: ${releaseError.message}`;
    } else {
      // Released reservations change derived finished-goods availability.
      void queryClient?.invalidateQueries({ queryKey: entityKeys.all("allocations") });
      void queryClient?.invalidateQueries({ queryKey: inventoryKeys.finishedGoods() });
      void queryClient?.invalidateQueries({
        queryKey: inventoryKeys.finishedGoodsAvailable(),
      });
      for (const orderId of ids) {
        void queryClient?.invalidateQueries({ queryKey: orderKeys.allocations(orderId) });
      }
    }
  }

  return result;
}
