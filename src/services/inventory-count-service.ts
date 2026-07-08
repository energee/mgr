/**
 * Inventory Count Domain Service
 *
 * Supabase writes for the guided cycle-count workflow (audit finding 27:
 * "no count workflow — the only path was the raw-UUID allocation form").
 * Pure reconciliation math lives in src/domain/inventory-count.ts; the UI
 * is src/components/domain/inventory/count-adjust-dialog.tsx.
 *
 * Modeling decisions:
 * - Count DECREASE (shrinkage): inserted as a completed allocation
 *   (source_type='inventory_lot', destination_type='adjustment',
 *   reason_code='count_adjustment') so it lands in the unified audit trail
 *   and the lots view's remaining_quantity math picks it up.
 * - Count INCREASE (found stock): allocations cannot add stock to a lot
 *   (CHECK (quantity >= 0) in 00010 + subtract-only view math in 00014),
 *   so increases update inventory_lots.quantity directly and append an
 *   audit line to the lot's notes as the paper trail. The write is a
 *   compare-and-swap on the pre-image quantity (`inventory_lots` has no
 *   `version` column) so a concurrent count/depletion can't be silently
 *   clobbered by a lost update (audit M15) — a stale write returns CONFLICT.
 * - Exact match: nothing is written.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { type ServiceResult, ok, err, parseSupabaseError } from "./types";
import {
  planCountAdjustment,
  buildCountIncreaseNote,
  appendLotNote,
  type CountAdjustmentPlan,
} from "@/domain/inventory-count";

type Client = SupabaseClient<Database>;

/**
 * Reconcile a physical count of one inventory lot against the system's
 * expected on-hand. Returns the plan that was applied so callers can
 * toast an accurate message ("no change" / "shrinkage recorded" / ...).
 */
export async function recordInventoryCount(
  supabase: Client,
  params: {
    lotId: string;
    /** System on-hand at count time (view's remaining_quantity). */
    expectedQuantity: number;
    /** Physically counted quantity (>= 0). */
    countedQuantity: number;
    notes?: string | null;
  }
): Promise<ServiceResult<CountAdjustmentPlan>> {
  try {
    const plan = planCountAdjustment(params.expectedQuantity, params.countedQuantity);

    if (plan.kind === "none") return ok(plan);

    if (plan.kind === "decrease") {
      const { error } = await supabase.from("allocations").insert({
        source_type: "inventory_lot",
        source_id: params.lotId,
        destination_type: "adjustment",
        destination_id: null,
        quantity: plan.delta,
        status: "completed",
        completed_at: new Date().toISOString(),
        reason_code: "count_adjustment",
        notes: params.notes?.trim() || null,
      });
      if (error) return err(parseSupabaseError(error, { table: "allocations" }));
      return ok(plan);
    }

    // Increase: read the lot fresh (quantity + notes), then write both back.
    const { data: lot, error: lotError } = await supabase
      .from("inventory_lots")
      .select("id, quantity, notes")
      .eq("id", params.lotId)
      .single();
    if (lotError) return err(parseSupabaseError(lotError, { table: "inventory_lots" }));

    const auditNote = buildCountIncreaseNote({
      countedOn: new Date().toISOString().slice(0, 10),
      expectedQuantity: params.expectedQuantity,
      countedQuantity: params.countedQuantity,
      notes: params.notes,
    });

    // Compare-and-swap on the pre-image quantity: the write only lands if no
    // concurrent count/depletion changed inventory_lots.quantity between our
    // read above and this write. ponytail: quantity CAS, not a version column
    // (the table has none) — ABA (two concurrent writes netting to the same
    // quantity) is not distinguished, acceptable for a manual count dialog.
    const { data: updatedRows, error: updateError } = await supabase
      .from("inventory_lots")
      .update({
        quantity: lot.quantity + plan.delta,
        notes: appendLotNote(lot.notes, auditNote),
      })
      .eq("id", params.lotId)
      .eq("quantity", lot.quantity)
      .select("id");
    if (updateError)
      return err(parseSupabaseError(updateError, { table: "inventory_lots" }));
    if (!updatedRows || updatedRows.length === 0)
      return err({
        code: "CONFLICT",
        currentVersion: lot.quantity,
        message:
          "This lot's on-hand changed while you were counting. Refresh and re-count.",
      });

    return ok(plan);
  } catch (e) {
    return err({
      code: "UNKNOWN",
      message: `Failed to record count: ${e instanceof Error ? e.message : String(e)}`,
      cause: e,
    });
  }
}
