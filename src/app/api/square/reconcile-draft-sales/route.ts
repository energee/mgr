/**
 * Square Draft-Sale Reconciliation (audit BD-2)
 *
 * POST: Converts unreconciled square_draft_sales rows (keg pours staged by the
 * payment webhook) into COMPLETED finished_good -> taproom_sale allocations so
 * draft sales reach TTB taxpaid removals — taproom pours are taxpaid removals
 * (docs/knowledge/brewing-domain.md), reported by get_ttb_removals_summary's
 * taproom_sale arm (00203). Purely DB-side: no Square API call, so it works
 * even while the Square client/integration is disabled.
 *
 * Model:
 * - A draft sale records volume (volume_oz), brand, and location — never WHICH
 *   physical keg it came from (docs/plans/2026-07-08-keg-lifecycle-reconciliation.md).
 *   The sold volume is therefore drawn FIFO across the BRAND's keg-format
 *   finished_goods lots (oldest production_date first, undated last — the same
 *   ordering as the webhook's packaged FIFO and record_keg_ship_transactions).
 * - Allocation `quantity` is in KEGS (fractional): drawn bbl / per-keg bbl.
 *   Finished-goods stock is ledger-style (docs/knowledge/entity-model.md):
 *   availability is finished_goods.quantity minus active allocations, both in
 *   kegs, and guard_allocation_availability (00212) enforces exactly that
 *   arithmetic — pour counts would not be comparable. volume_bbl is the
 *   TTB-authoritative field: drawn oz / OZ_PER_BARREL (3968), the same
 *   constant computeUnitFillVolumeBbl and the 00203 SQL use.
 * - Exactly-once per draft sale: every allocation row carries
 *   idempotency_key `square_draft_sale:<id>` (the 00215 pattern — one key may
 *   tag SEVERAL rows when a sale spans lots). The key check, the allocation
 *   insert, and the square_draft_sales.reconciled_at stamp (00243) run as ONE
 *   transaction in `reconcile_square_draft_sale_atomic` (00293), serialized
 *   per sale by an advisory xact lock — so concurrent runs cannot
 *   double-allocate (#834), a guard rejection lands none of the rows, and a
 *   re-run repairs a missing stamp without re-inserting. Rows the refund
 *   webhook voided (voided_at, 00241) are excluded at read time AND
 *   re-checked inside the transaction — a refunded pour must never become a
 *   TTB removal.
 * - Per-row failures (guard_allocation_availability rejection, missing
 *   volume_oz, insufficient keg availability) are surfaced in the response and
 *   the draft_reconcile square_sync_log row; the batch continues — one bad row
 *   never aborts the run.
 *
 * dynamicFrom is used wherever the query touches 00243 columns
 * (reconciled_at, pour_size_oz), idempotency_key (00215), or embedded-resource
 * filters — none of which the generated types/typed builder support yet.
 */

import { withPermission } from "@/lib/api/auth";
import { successResponse } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/server";
import { logSyncFailure } from "@/integrations/square/route-helpers";
import type { SquareSyncType } from "@/integrations/square/types";
import { computeUnitFillVolumeBbl, OZ_PER_BARREL } from "@/domain/consumption-planning";
import { dynamicFrom, dynamicRpc } from "@/services/types";
import { logger } from "@/lib/logger";

const log = logger.child({ route: "/api/square/reconcile-draft-sales" });

/**
 * Float-noise tolerance for "the sale is fully covered", in bbl. A single pour
 * is ~0.004 bbl, so 1e-6 bbl (~0.004 oz) can only absorb arithmetic noise,
 * never a real shortfall.
 */
const EPSILON_BBL = 1e-6;

type DraftSaleRow = {
  id: string;
  brand_id: string;
  selling_format_id: string | null;
  quantity: number;
  volume_oz: number | null;
  sold_at: string;
  square_order_id: string;
};

/** One keg-format finished-good lot with derived availability (in kegs). */
type KegLot = {
  id: string;
  brand_id: string;
  production_date: string | null;
  /** Per-keg fill volume in bbl (computeUnitFillVolumeBbl); null = unusable. */
  perKegBbl: number | null;
  /** finished_goods.quantity − Σ active allocations, clamped at 0 (in kegs). */
  availableKegs: number;
};

type Failure = { draftSaleId: string; error: string };

export const POST = withPermission("integrations:manage", async (_request, { user }) => {
  const admin = await createAdminClient();
  const startedAt = new Date().toISOString();

  try {
    // 1. Unreconciled draft sales, oldest first — FIFO consumes in sale order
    //    so two sales of one brand drain the same lot deterministically.
    //    voided_at rows are excluded: the refund webhook (00241) voids a fully
    //    refunded un-reconciled pour, and reconciling it would post a TTB
    //    removal for beer that was refunded, not removed.
    const { data: draftRows, error: draftError } = await dynamicFrom(admin, "square_draft_sales")
      .select("id, brand_id, selling_format_id, quantity, volume_oz, sold_at, square_order_id")
      .is("reconciled_at", null)
      .is("voided_at", null)
      .order("sold_at", { ascending: true });
    if (draftError) throw new Error(`Failed to query draft sales: ${draftError.message}`);

    const sales = (draftRows ?? []) as DraftSaleRow[];
    if (sales.length === 0) {
      return successResponse({
        processed: 0,
        reconciled: 0,
        alreadyReconciled: 0,
        failed: 0,
        failures: [] as Failure[],
        totalVolumeBbl: 0,
      });
    }

    // 2. Which sales already carry allocations? (Crash between the allocation
    //    insert and the reconciled_at stamp leaves a keyed-but-unstamped sale;
    //    those must NOT re-allocate.) One batched read over the stable
    //    idempotency keys (00215).
    const keyFor = (saleId: string) => `square_draft_sale:${saleId}`;
    const { data: keyRows, error: keyError } = await dynamicFrom(admin, "allocations")
      .select("idempotency_key")
      .in(
        "idempotency_key",
        sales.map((s) => keyFor(s.id))
      );
    if (keyError) throw new Error(`Failed to query existing reconciliations: ${keyError.message}`);
    const alreadyKeyed = new Set(
      ((keyRows ?? []) as Array<{ idempotency_key: string | null }>).map((r) => r.idempotency_key)
    );

    // 3. Every brand's keg-format lots (containers.type = 'keg' via the
    //    selling-format join; embedded filter needs dynamicFrom). volume_bbl is
    //    required for keg containers (00199), so perKegBbl should always
    //    resolve — a null marks the lot unusable rather than guessing.
    const brandIds = [...new Set(sales.map((s) => s.brand_id))];
    const { data: lotRows, error: lotError } = await dynamicFrom(admin, "finished_goods")
      .select(
        "id, brand_id, quantity, production_date, selling_formats!inner(unit_count, containers!inner(type, volume_oz, volume_bbl))"
      )
      .in("brand_id", brandIds)
      .eq("selling_formats.containers.type", "keg")
      .gt("quantity", 0);
    if (lotError) throw new Error(`Failed to query keg finished goods: ${lotError.message}`);

    type LotRow = {
      id: string;
      brand_id: string;
      quantity: number;
      production_date: string | null;
      selling_formats: {
        unit_count: number | null;
        containers: { type: string; volume_oz: number | null; volume_bbl: number | null } | null;
      } | null;
    };
    const rawLots = (lotRows ?? []) as LotRow[];

    // 4. Availability per lot = quantity − Σ active (planned/completed)
    //    allocations from it — exactly guard_allocation_availability's (00212)
    //    arithmetic, so the in-memory plan and the DB guard agree. The rows
    //    found in step 2 are included here too (consistent double-entry).
    const allocatedByLot = new Map<string, number>();
    if (rawLots.length > 0) {
      const { data: allocRows, error: allocReadError } = await admin
        .from("allocations")
        .select("source_id, quantity")
        .eq("source_type", "finished_good")
        .in(
          "source_id",
          rawLots.map((l) => l.id)
        )
        .in("status", ["planned", "completed"]);
      if (allocReadError) {
        throw new Error(`Failed to query existing allocations: ${allocReadError.message}`);
      }
      for (const a of allocRows ?? []) {
        if (!a.source_id) continue;
        allocatedByLot.set(a.source_id, (allocatedByLot.get(a.source_id) ?? 0) + a.quantity);
      }
    }

    // FIFO order per brand: oldest production_date first, undated lots last
    // (mirrors the webhook's packaged FIFO and record_keg_ship_transactions).
    const lotsByBrand = new Map<string, KegLot[]>();
    for (const l of rawLots) {
      const lot: KegLot = {
        id: l.id,
        brand_id: l.brand_id,
        production_date: l.production_date,
        perKegBbl: computeUnitFillVolumeBbl({
          unit_count: l.selling_formats?.unit_count ?? null,
          container: l.selling_formats?.containers ?? null,
        }),
        availableKegs: Math.max(0, l.quantity - (allocatedByLot.get(l.id) ?? 0)),
      };
      const list = lotsByBrand.get(l.brand_id);
      if (list) list.push(lot);
      else lotsByBrand.set(l.brand_id, [lot]);
    }
    const prodTime = (l: KegLot) =>
      l.production_date ? new Date(l.production_date).getTime() : Number.POSITIVE_INFINITY;
    for (const lots of lotsByBrand.values()) lots.sort((a, b) => prodTime(a) - prodTime(b));

    // 5. Per sale: plan FIFO in memory, insert atomically, stamp reconciled_at.
    let reconciled = 0;
    let alreadyReconciled = 0;
    let totalVolumeBbl = 0;
    const failures: Failure[] = [];
    const now = new Date().toISOString();

    // tx-ok: check-key + allocation insert + reconciled_at stamp are one
    // transaction in reconcile_square_draft_sale_atomic (00293), serialized
    // per sale by an advisory xact lock — concurrent runs cannot
    // double-allocate (#834). The only writes outside it are the deliberately
    // non-fatal square_sync_log summary below.
    const reconcileAtomic = async (saleId: string, rows: unknown[]) => {
      const { data, error } = await dynamicRpc(admin, "reconcile_square_draft_sale_atomic", {
        p_sale_id: saleId,
        p_rows: rows,
        p_reconciled_at: now,
      });
      if (error) return { outcome: null, error: error.message };
      return { outcome: data as "inserted" | "already_keyed" | "voided", error: null };
    };

    for (const sale of sales) {
      const key = keyFor(sale.id);

      // Already allocated (idempotent re-run, or a crash before 00293's
      // atomic stamp existed): the RPC re-stamps without re-inserting.
      if (alreadyKeyed.has(key)) {
        const { outcome, error } = await reconcileAtomic(sale.id, []);
        if (error) {
          failures.push({
            draftSaleId: sale.id,
            error: `Already allocated but reconciled_at re-stamp failed: ${error} — re-run to repair`,
          });
          continue;
        }
        if (outcome === "already_keyed") alreadyReconciled++;
        continue;
      }

      // volume_oz is nullable in the schema; without it there is no removal
      // volume to record — fail loudly, never guess.
      if (sale.volume_oz == null || sale.volume_oz <= 0) {
        failures.push({
          draftSaleId: sale.id,
          error: `Draft sale has no usable volume_oz (${sale.volume_oz}) — cannot compute TTB removal volume`,
        });
        continue;
      }

      const saleBbl = sale.volume_oz / OZ_PER_BARREL;

      // Plan the FIFO draw against in-memory availability. Nothing is
      // decremented until the DB accepts the insert, so a failed sale leaves
      // the pool intact for the next one.
      const brandLots = lotsByBrand.get(sale.brand_id) ?? [];
      let remainingBbl = saleBbl;
      const draws: Array<{ lot: KegLot; kegs: number; bbl: number }> = [];
      for (const lot of brandLots) {
        if (remainingBbl <= EPSILON_BBL) break;
        if (lot.availableKegs <= 0 || lot.perKegBbl == null || lot.perKegBbl <= 0) continue;
        const capacityBbl = lot.availableKegs * lot.perKegBbl;
        const drawBbl = Math.min(remainingBbl, capacityBbl);
        if (drawBbl <= 0) continue;
        draws.push({ lot, kegs: drawBbl / lot.perKegBbl, bbl: drawBbl });
        remainingBbl -= drawBbl;
      }

      if (remainingBbl > EPSILON_BBL) {
        failures.push({
          draftSaleId: sale.id,
          error: `Insufficient keg-format finished-good availability for brand ${sale.brand_id}: ${remainingBbl.toFixed(4)} of ${saleBbl.toFixed(4)} bbl uncovered`,
        });
        continue;
      }

      // The whole sale lands (or not) in ONE transaction: the RPC claims the
      // key, inserts every row, and stamps reconciled_at together, so a
      // guard_allocation_availability rejection on any row lands NONE of
      // them — the key stays unclaimed and the failure is retryable. The RPC
      // derives the idempotency key from the sale id itself.
      const rows = draws.map((d) => ({
        source_id: d.lot.id,
        quantity: d.kegs,
        volume_bbl: d.bbl,
        // The SALE time, not the reconcile time — TTB removals must land in
        // the period the beer actually left (same choice as the webhook's
        // packaged path using event.created_at).
        completed_at: sale.sold_at,
        notes: `Square draft sale reconciliation (order ${sale.square_order_id})`,
      }));
      const { outcome, error: rpcError } = await reconcileAtomic(sale.id, rows);
      if (rpcError) {
        // Most commonly guard_allocation_availability (00212) rejecting a
        // concurrent-consumption race; surfaced per row, batch continues.
        failures.push({ draftSaleId: sale.id, error: rpcError });
        continue;
      }

      if (outcome === "already_keyed") {
        // A concurrent run won the per-sale lock and allocated first; its
        // rows are the truth and ours were discarded inside the transaction.
        alreadyReconciled++;
        continue;
      }
      if (outcome === "voided") {
        // Refund webhook voided the sale after our read; nothing was written.
        log.info({ draftSaleId: sale.id }, "Draft sale voided mid-run; skipped");
        continue;
      }

      // Commit the in-memory decrements only after the DB accepted the draw.
      for (const d of draws) d.lot.availableKegs -= d.kegs;

      reconciled++;
      totalVolumeBbl += saleBbl;
    }

    // 6. Durable per-run summary. A failed log write must not fail the run
    //    (the allocations already landed) but must not be silent either.
    const completedAt = new Date().toISOString();
    const { error: logError } = await admin.from("square_sync_log").insert({
      sync_type: "draft_reconcile" satisfies SquareSyncType,
      items_synced: reconciled,
      items_failed: failures.length,
      details: {
        processed: sales.length,
        alreadyReconciled,
        totalVolumeBbl,
        ...(failures.length > 0 ? { failures } : {}),
        triggeredBy: user.id,
      },
      started_at: startedAt,
      completed_at: completedAt,
    });
    if (logError) {
      log.error({ err: logError.message }, "Failed to write draft_reconcile sync-log row");
    }

    return successResponse({
      processed: sales.length,
      reconciled,
      alreadyReconciled,
      failed: failures.length,
      failures,
      totalVolumeBbl,
    });
  } catch (err) {
    return logSyncFailure(admin, {
      syncType: "draft_reconcile",
      startedAt,
      userId: user.id,
      err,
    });
  }
});
