"use client";

/**
 * usePoAcceptMutation — the "accept receives into inventory" write path of
 * the PO Accept dialog (po-accept-inventory-dialog.tsx), extracted as a
 * hook so the dialog file stays presentational.
 *
 * The mutation is a two-step write: (1) insert one inventory_lots row per
 * selected receive (linked back via po_receive_id for the landed-cost
 * pipeline, with the legacy free-text location column mirroring the
 * canonical bin name), then (2) insert structured bin_inventory_items
 * placement rows for rows that chose a bin. Step 2 failing after step 1
 * succeeded is surfaced with a precise message (lots exist, placement
 * doesn't) rather than the generic failure toast, and invalidation runs
 * onSettled — not onSuccess — because the lots insert may have succeeded
 * even when the mutation as a whole rejected.
 *
 * Both steps are plain PostgREST inserts, so they are two autocommit
 * transactions rather than one — which is why step 2 compensates with a
 * message instead of rolling step 1 back. That is what the entry for this
 * file in scripts/check-write-atomicity.allowlist.txt records; it moved
 * here with the code, having been grandfathered under the dialog's path.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import {
  poReceiveKeys,
  entityKeys,
  binKeys,
  inventoryKeys,
} from "@/lib/query-keys";
import { inventoryLotCore } from "@/entities/inventory-lot/core";
import { log } from "@/lib/client-logger";
import {
  buildBinPlacements,
  type UnacceptedReceive,
  type RowState,
} from "@/domain/purchasing/po-accept-utils";

/** Error message used when lots were created but bin placement failed */
const PLACEMENT_FAILED_MESSAGE =
  "Items were accepted, but bin placement failed — assign bins from the bin pages.";

type UsePoAcceptMutationArgs = {
  /** Rows the user has selected for acceptance */
  selectedReceives: UnacceptedReceive[];
  /** Effective row state (user override or prefill default) per receive */
  getRowState: (r: UnacceptedReceive) => RowState;
  /** Canonical bin name lookup for mirroring into the legacy location column */
  binNameById: Map<string, string>;
  /** Called after a fully successful acceptance (reset row state + close) */
  onAccepted: () => void;
}

/** Mutation: create inventory_lots, then structured bin placements */
export function usePoAcceptMutation({
  selectedReceives,
  getRowState,
  binNameById,
  onAccepted,
}: UsePoAcceptMutationArgs) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const lotsToInsert = selectedReceives.map((r) => {
        const state = getRowState(r);
        return {
          inventory_item_id: state.inventory_item_id,
          po_receive_id: r.receive_id,
          quantity: r.quantity,
          unit: r.unit,
          unit_cost: r.unit_price,
          lot_number: r.lot_number,
          expiration_date: r.expiration_date,
          received_date: r.received_date,
          // Legacy text column mirrors the canonical bin name so existing
          // location display/search keeps working; the structured placement
          // lives in bin_inventory_items (inserted below).
          location: state.bin_id
            ? binNameById.get(state.bin_id) ?? null
            : null,
        };
      });

      const { data: insertedLots, error } = await supabase
        .from("inventory_lots")
        .insert(lotsToInsert)
        .select("id, po_receive_id");

      if (error) throw error;

      // Structured lot↔bin placement rows (quantity = full lot quantity)
      const placementByReceiveId = new Map(
        selectedReceives.flatMap((r) => {
          const state = getRowState(r);
          return state.bin_id
            ? ([[r.receive_id, { bin_id: state.bin_id, quantity: r.quantity }]] as const)
            : [];
        })
      );
      const placements = buildBinPlacements(
        insertedLots ?? [],
        placementByReceiveId
      );
      if (placements.length > 0) {
        const { error: placementError } = await supabase
          .from("bin_inventory_items")
          .insert(placements);
        if (placementError) {
          // Lots are already accepted at this point — surface a precise
          // message instead of the generic failure toast.
          log.error("Bin placement insert error:", placementError);
          throw new Error(PLACEMENT_FAILED_MESSAGE);
        }
      }
    },
    onSuccess: () => {
      const count = selectedReceives.length;
      toast.success(
        `${count} item${count !== 1 ? "s" : ""} accepted into inventory`
      );
      onAccepted();
    },
    onError: (error) => {
      log.error("Accept into inventory error:", error);
      toast.error(
        error instanceof Error && error.message === PLACEMENT_FAILED_MESSAGE
          ? PLACEMENT_FAILED_MESSAGE
          : "Failed to accept items into inventory"
      );
    },
    // Invalidate on settled (not just success): the lots insert may have
    // succeeded even when bin placement subsequently failed. The whole
    // po-receives namespace is invalidated so mapping defaults pick up
    // this acceptance as the newest mapping.
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: poReceiveKeys.all(),
      });
      // Both the base table and the view: the lots list/detail pages key off
      // `viewTable ?? table`, so they cache under
      // `inventory_lots_with_quantities` and the base-table key alone reaches
      // nothing (issue #615, same class as #560). Derived from the entity core
      // rather than typed literals so a view rename keeps the pair correct —
      // this mirrors invalidationKeys() in entity-service.ts, which this raw
      // insert bypasses.
      queryClient.invalidateQueries({
        queryKey: entityKeys.all(inventoryLotCore.table),
      });
      queryClient.invalidateQueries({
        queryKey: entityKeys.all(inventoryLotCore.viewTable!),
      });
      // Aggregates summed over lot rows.
      queryClient.invalidateQueries({ queryKey: inventoryKeys.itemOnHand() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.lots() });
      queryClient.invalidateQueries({ queryKey: binKeys.all() });
    },
  });
}
