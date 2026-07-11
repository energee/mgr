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
 * - orders → fulfilled: complete FG→order reservations + stamp TTB removal
 *   volume; when an order has NO reservations, synthesize completed removal
 *   allocations from its order_items (audit BD-5)
 * - orders → cancelled: release still-planned FG→order reservations
 * - deliveries → completed: flip linked packed orders to fulfilled and chain
 *   the orders → fulfilled effect (audit EA-2)
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
import { log } from "@/lib/client-logger";
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
  //
  // Orders with NO planned reservations (audit BD-5: live has never created
  // FG→order reservations, so the completion path above never fired and TTB
  // taxpaid removals stayed ~0) instead get completed removal allocations
  // SYNTHESIZED from their order_items — see
  // synthesizeFulfillmentRemovals below for the FIFO/idempotency/keg rules.
  if (table === "orders" && toState === "fulfilled") {
    const { data: planned, error: readError } = await supabase
      .from("allocations")
      .select("id, source_id, quantity, destination_id")
      .eq("destination_type", "order")
      .in("destination_id", ids)
      .eq("source_type", "finished_good")
      .eq("status", "planned");

    if (readError) {
      result.error = `Order fulfilled, but completing its inventory reservations failed: ${readError.message}`;
    } else {
      const rows = planned ?? [];
      const parts: string[] = [];
      let wroteAllocations = false;

      if (rows.length > 0) {
        wroteAllocations = true;

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
      }

      // BD-5: orders with no planned reservations get their removal
      // allocations synthesized from order_items. Per-order all-or-nothing:
      // any planned reservation means the allocation-dialog / pick-list flow
      // was used, and the completion path above is the source of truth.
      const reservedOrderIds = new Set(
        rows.map((r) => r.destination_id).filter((id): id is string => !!id)
      );
      const synthOrderIds = ids.filter((id) => !reservedOrderIds.has(id));
      if (synthOrderIds.length > 0) {
        const synth = await synthesizeFulfillmentRemovals(supabase, synthOrderIds);
        parts.push(...synth.warnings);
        if (synth.inserted > 0) wroteAllocations = true;
      }

      if (parts.length > 0) {
        result.error = `Order fulfilled, but ${parts.join("; ")}`;
      }

      if (wroteAllocations) {
        // Completed removals feed the allocations list, TTB report, and each
        // order's allocation panel. (entityKeys.all("allocations") is the same
        // ["allocations"] root inventoryKeys.allocations() returns.)
        void queryClient?.invalidateQueries({ queryKey: entityKeys.all("allocations") });
        for (const orderId of ids) {
          void queryClient?.invalidateQueries({ queryKey: orderKeys.allocations(orderId) });
        }
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

  // deliveries → completed: a completed delivery run means the beer physically
  // shipped, so flip each linked order (orders.delivery_id) from packed to
  // fulfilled and chain the orders → fulfilled entry above for the flipped ids
  // (audit EA-2 — before this entry, completing a delivery left its orders
  // "packed" forever and their removals never reached the TTB report). Same
  // status-guarded shape as the pick_lists sync, with two deliberate
  // differences:
  // - one UPDATE PER ORDER instead of a single bulk UPDATE: the orders status
  //   flip fires the on_order_fulfillment_keg_transactions DB trigger
  //   (00183/00229), which RAISEs on a keg shortfall — per-order statements
  //   keep one bad order from aborting every other order on the run
  //   (partial-failure tolerant).
  // - .select("id") on the UPDATE so only rows that actually flipped are
  //   chained into the fulfillment side effect.
  // Idempotent: the .eq("status", "packed") guard makes a re-run (or a raced
  // second path) match 0 rows; orders in earlier states (draft/picking/...)
  // are deliberately NOT flipped — completing a delivery is evidence of
  // shipment only for orders that finished packing.
  if (table === "deliveries" && toState === "completed") {
    const { data: linked, error: linkError } = await supabase
      .from("orders")
      .select("id")
      .in("delivery_id", ids)
      .eq("status", "packed");

    if (linkError) {
      result.error = `Delivery completed, but syncing its orders failed: ${linkError.message}`;
    } else if ((linked ?? []).length > 0) {
      const flipped: string[] = [];
      const flipFailures: string[] = [];
      for (const order of linked ?? []) {
        const { data: updatedRows, error: flipError } = await supabase
          .from("orders")
          .update({ status: "fulfilled" })
          .eq("id", order.id)
          .eq("status", "packed")
          .select("id");
        if (flipError) {
          flipFailures.push(flipError.message);
        } else if ((updatedRows ?? []).length > 0) {
          flipped.push(order.id);
        }
      }

      const parts: string[] = [];
      if (flipFailures.length > 0) {
        parts.push(
          `fulfilling ${flipFailures.length} linked order(s) failed: ${[...new Set(flipFailures)].join("; ")}`
        );
        log.error(
          "deliveries → completed side effect: fulfilling linked orders failed",
          flipFailures
        );
      }

      if (flipped.length > 0) {
        // Chain the orders → fulfilled entry for the ids that actually
        // flipped, so their reservations complete / removals synthesize
        // exactly as if the orders had been fulfilled directly.
        const chained = await runTransitionSideEffects(
          supabase,
          "orders",
          flipped,
          "fulfilled",
          queryClient
        );
        if (chained.error) parts.push(chained.error);
        // Orders were touched cross-table — refresh their caches (the chained
        // call already refreshed allocation caches).
        void queryClient?.invalidateQueries({ queryKey: entityKeys.all("orders") });
      }

      if (parts.length > 0) {
        result.error = `Delivery completed, but ${parts.join("; ")}`;
      }
    }
  }

  return result;
}

// =============================================================================
// BD-5: fulfillment removal synthesis
// =============================================================================

/**
 * Idempotency key for a synthesized removal allocation. One key per
 * (order, order_item); a line that FIFO-splits across several finished-goods
 * lots writes SEVERAL rows under the same key — matching the 00215 contract
 * (plain partial index, not unique; `pkg_session:<id>` works the same way).
 */
const fulfillmentSynthesisKey = (orderId: string, orderItemId: string) =>
  `order_fulfill:${orderId}:${orderItemId}`;

const FULFILLMENT_SYNTHESIS_KEY_PREFIX = "order_fulfill:";

/** Outcome of synthesizing removal allocations for reservation-less orders. */
type FulfillmentSynthesisOutcome = {
  /** Completed FG→order allocation rows successfully inserted. */
  inserted: number;
  /** Non-fatal, toast-ready warning fragments (fulfillment always stands). */
  warnings: string[];
};

/**
 * Synthesize completed finished_good→order removal allocations from an
 * order's line items, for orders fulfilled WITHOUT any FG→order reservations
 * (audit BD-5: the reservation flow has never been used live, so the
 * completion path in `runTransitionSideEffects` never fired and TTB taxpaid
 * removals stayed ~0 despite being code-complete).
 *
 * Resolution rule (mirrors create_keg_ship_transactions_from_order,
 * 00229/00234): each line's (brand_id, selling_format_id) resolves to
 * candidate finished_goods lots drawn FIFO by production_date NULLS LAST,
 * then lot_number; a NULL-brand line draws across every brand in its format,
 * and named-brand lines are planned first so a wildcard line cannot strip
 * lots a named line needs. Availability per lot is quantity minus active
 * (planned/completed) allocations — the exact math of the server-side
 * availability guard (00212) — decremented in-memory across lines AND across
 * orders in the same run so one bulk fulfillment cannot plan the same units
 * twice.
 *
 * KEG LINES ARE EXCLUDED (containers.type = 'keg') — DEFERRED, deliberate:
 * keg lines already flow through the on_order_fulfillment_keg_transactions
 * DB trigger → create_keg_ship_transactions_from_order (00183/00229/00234),
 * which draws lots FIFO over keg_filled_contents (fills − ships, including
 * pre-fix ships that have no allocations). A second, independent FIFO over
 * allocation-availability (which is blind to historical keg ships) can
 * attribute the same physical shipment to a DIFFERENT lot than the keg
 * ledger drew — a per-lot double-spend of headroom that would also let a
 * misattributed allocation block legitimate revise-downs via
 * guard_finished_good_outbound (00216). There is no aggregate double count
 * today (TTB reads only allocations; Square keg counts read only
 * keg_filled_contents; bin_inventory never holds kegs — 00221's guard), but
 * per-lot attribution divergence corrupts traceability. The correct keg fix
 * is to mirror the keg_transactions ship legs themselves (since 00229 they
 * carry exact per-lot draws keyed by order_id) into allocations — or extend
 * the TTB removals SQL (00203) with a keg_transactions arm. Until then,
 * keg wholesale removals remain TTB-invisible (documented in audit BD-5).
 *
 * Idempotency: every row carries `order_fulfill:<order_id>:<order_item_id>`
 * (00215). Re-runs skip items whose key already exists; a partial-failure
 * re-run retries only the missing items. An order that has ANY active
 * FG→order allocation WITHOUT that prefix is skipped entirely — it was (or
 * is being) handled by the reservation flow, e.g. a racing path completed
 * its planned reservations between our planned-read and this call.
 *
 * Guard-rejection / shortfall policy (decided): the fulfillment ALWAYS
 * stands — staff recording a shipment that physically happened must not be
 * blocked by ledger state (same philosophy as consumePackagingMaterials'
 * shortfall reporting and the webhook's clamped-race handling). The plan
 * draws only what the availability math allows; any uncovered remainder is
 * surfaced as a warning (TTB under-reports VISIBLY, never silently). If an
 * insert is still rejected — e.g. guard_allocation_availability (00212)
 * trips on a concurrent allocator between our read and the insert — the
 * rejection is logged AND returned in the side-effect result; other rows
 * proceed (per-row inserts, partial-failure tolerant).
 */
async function synthesizeFulfillmentRemovals(
  supabase: Client,
  orderIds: string[]
): Promise<FulfillmentSynthesisOutcome> {
  const warnings: string[] = [];
  let inserted = 0;

  // (1) Race + idempotency guard: existing active FG→order allocations.
  const { data: existingData, error: existingError } = await supabase
    .from("allocations")
    .select("destination_id, idempotency_key")
    .eq("destination_type", "order")
    .in("destination_id", orderIds)
    .eq("source_type", "finished_good")
    .in("status", ["planned", "completed"]);
  if (existingError) {
    warnings.push(`synthesizing removal allocations failed: ${existingError.message}`);
    return { inserted, warnings };
  }
  const doneKeys = new Set<string>();
  const externallyAllocated = new Set<string>();
  for (const row of existingData ?? []) {
    if (row.idempotency_key?.startsWith(FULFILLMENT_SYNTHESIS_KEY_PREFIX)) {
      doneKeys.add(row.idempotency_key);
    } else if (row.destination_id) {
      externallyAllocated.add(row.destination_id);
    }
  }
  const targets = orderIds.filter((id) => !externallyAllocated.has(id));
  if (targets.length === 0) return { inserted, warnings };

  // (2) The orders' line items.
  const { data: itemsData, error: itemsError } = await supabase
    .from("order_items")
    .select("id, order_id, brand_id, selling_format_id, quantity")
    .in("order_id", targets)
    .gt("quantity", 0);
  if (itemsError) {
    warnings.push(`synthesizing removal allocations failed: ${itemsError.message}`);
    return { inserted, warnings };
  }
  let items = (itemsData ?? []).filter(
    (it) => !doneKeys.has(fulfillmentSynthesisKey(it.order_id, it.id))
  );
  if (items.length === 0) return { inserted, warnings };

  const missingFormat = items.filter((it) => !it.selling_format_id).length;
  if (missingFormat > 0) {
    warnings.push(
      `${missingFormat} order line(s) have no selling format and were skipped — their TTB removal volume is not recorded until the line names a format`
    );
  }
  items = items.filter((it) => !!it.selling_format_id);
  if (items.length === 0) return { inserted, warnings };

  // (3) Selling formats + containers: keg detection and per-unit volume.
  const formatIds = [...new Set(items.map((it) => it.selling_format_id as string))];
  const { data: formatsData, error: formatsError } = await supabase
    .from("selling_formats")
    .select("id, unit_count, container:containers(type, volume_bbl, volume_oz)")
    .in("id", formatIds);
  if (formatsError) {
    warnings.push(`synthesizing removal allocations failed: ${formatsError.message}`);
    return { inserted, warnings };
  }
  type FormatRow = {
    id: string;
    unit_count: number | null;
    container: { type: string | null; volume_bbl: number | null; volume_oz: number | null } | null;
  };
  const formatById = new Map<string, FormatRow>();
  for (const f of (formatsData ?? []) as unknown as FormatRow[]) formatById.set(f.id, f);

  // Keg lines: handled by the keg_transactions ledger — see the doc comment.
  items = items.filter(
    (it) => formatById.get(it.selling_format_id as string)?.container?.type !== "keg"
  );
  if (items.length === 0) return { inserted, warnings };

  // (4) Candidate lots for the remaining (non-keg) formats.
  const neededFormatIds = [...new Set(items.map((it) => it.selling_format_id as string))];
  const { data: lotsData, error: lotsError } = await supabase
    .from("finished_goods")
    .select("id, brand_id, selling_format_id, quantity, production_date, lot_number")
    .in("selling_format_id", neededFormatIds)
    .gt("quantity", 0);
  if (lotsError) {
    warnings.push(`synthesizing removal allocations failed: ${lotsError.message}`);
    return { inserted, warnings };
  }
  type LotRow = {
    id: string;
    brand_id: string | null;
    selling_format_id: string | null;
    quantity: number;
    production_date: string | null;
    lot_number: string | null;
  };
  const lots = (lotsData ?? []) as unknown as LotRow[];

  // (5) Active allocations against those lots → per-lot availability
  // (quantity − planned/completed allocations: the 00212 guard's math).
  const remainingByLot = new Map<string, number>();
  for (const lot of lots) remainingByLot.set(lot.id, Number(lot.quantity));
  if (lots.length > 0) {
    const { data: allocData, error: allocError } = await supabase
      .from("allocations")
      .select("source_id, quantity")
      .eq("source_type", "finished_good")
      .in(
        "source_id",
        lots.map((l) => l.id)
      )
      .in("status", ["planned", "completed"]);
    if (allocError) {
      warnings.push(`synthesizing removal allocations failed: ${allocError.message}`);
      return { inserted, warnings };
    }
    for (const a of allocData ?? []) {
      if (!a.source_id) continue;
      const prev = remainingByLot.get(a.source_id);
      if (prev != null) remainingByLot.set(a.source_id, prev - Number(a.quantity));
    }
  }

  // (6) Plan the FIFO draw. Lot order: production_date NULLS LAST, then
  // lot_number NULLS LAST, then id (00229/00234's deterministic total order).
  const sortedLots = [...lots].sort((a, b) => {
    const at = a.production_date ? new Date(a.production_date).getTime() : Number.POSITIVE_INFINITY;
    const bt = b.production_date ? new Date(b.production_date).getTime() : Number.POSITIVE_INFINITY;
    if (at !== bt) return at - bt;
    if (a.lot_number !== b.lot_number) {
      if (a.lot_number == null) return 1;
      if (b.lot_number == null) return -1;
      return a.lot_number < b.lot_number ? -1 : 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  // Named-brand lines plan before NULL-brand (wildcard) lines — 00229's rule.
  const sortedItems = [...items].sort((a, b) => {
    if ((a.brand_id == null) !== (b.brand_id == null)) return a.brand_id == null ? 1 : -1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const completedAt = new Date().toISOString();
  const inserts: Database["public"]["Tables"]["allocations"]["Insert"][] = [];
  let missingVolume = 0;
  let shortfallLines = 0;
  for (const item of sortedItems) {
    const format = formatById.get(item.selling_format_id as string);
    const unitVol = format
      ? computeUnitFillVolumeBbl({
          unit_count: format.unit_count,
          container: format.container
            ? { volume_bbl: format.container.volume_bbl, volume_oz: format.container.volume_oz }
            : null,
        })
      : null;
    if (unitVol == null) missingVolume += 1;

    let remaining = Number(item.quantity);
    for (const lot of sortedLots) {
      if (remaining <= 0) break;
      if (lot.selling_format_id !== item.selling_format_id) continue;
      if (item.brand_id != null && lot.brand_id !== item.brand_id) continue;
      const avail = remainingByLot.get(lot.id) ?? 0;
      if (avail <= 0) continue;
      const draw = Math.min(remaining, avail);
      inserts.push({
        source_type: "finished_good",
        source_id: lot.id,
        destination_type: "order",
        destination_id: item.order_id,
        quantity: draw,
        volume_bbl: unitVol != null ? unitVol * draw : null,
        status: "completed",
        completed_at: completedAt,
        lot_number: lot.lot_number,
        notes: `Order fulfillment removal (synthesized from order line ${item.id})`,
        idempotency_key: fulfillmentSynthesisKey(item.order_id, item.id),
      });
      remainingByLot.set(lot.id, avail - draw);
      remaining -= draw;
    }
    if (remaining > 0) shortfallLines += 1;
  }

  if (missingVolume > 0) {
    warnings.push(
      `${missingVolume} order line(s) have no container volume data — their removal allocations carry no volume and TTB removals will under-report until the container volume is backfilled`
    );
  }
  if (shortfallLines > 0) {
    // Policy: fulfillment stands; the uncovered remainder gets NO allocation
    // row (never a row exceeding availability — that would just trip 00212).
    warnings.push(
      `${shortfallLines} order line(s) exceed available finished-goods stock — the uncovered quantity has no removal allocation and TTB removals will under-report (record the missing packaging, then add the allocation manually)`
    );
    log.warn("Order fulfillment removal synthesis: insufficient finished-goods stock", {
      orderIds: targets,
      shortfallLines,
    });
  }

  // (7) Insert per row: guard_allocation_availability (00212) can still
  // reject on a concurrent allocator race; per-row inserts keep one rejection
  // from aborting the other rows.
  const insertFailures: string[] = [];
  for (const row of inserts) {
    const { error: insertError } = await supabase.from("allocations").insert(row);
    if (insertError) insertFailures.push(insertError.message);
    else inserted += 1;
  }
  if (insertFailures.length > 0) {
    warnings.push(
      `recording ${insertFailures.length} removal allocation(s) failed: ${[...new Set(insertFailures)].join("; ")}`
    );
    log.error("Order fulfillment removal synthesis: allocation insert(s) rejected", insertFailures);
  }

  return { inserted, warnings };
}
