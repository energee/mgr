/**
 * Inventory Domain Service
 *
 * Wraps inventory-specific operations (RPC overview, expiring lot queries)
 * in the ServiceResult pattern. Consolidates logic previously duplicated
 * between AI chat tools and the inventory-alerts component.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { type ServiceResult, ok, err, parseSupabaseError, dynamicFrom } from "./types";

/** An inventory lot approaching expiration. */
export type ExpiringLot = {
  id: string;
  item_name: string;
  lot_number: string;
  remaining_quantity: number;
  unit: string;
  expiration_date: string;
  days_until_expiry: number;
  location_name: string | null;
}

export const inventoryService = {
  /**
   * Get inventory lots expiring within the specified number of days.
   * Uses the `inventory_lots_with_quantities` view for remaining_quantity
   * (after allocations) and joins to inventory_items for the item name.
   * Note: `location` is a plain TEXT column on inventory_lots, not a FK.
   *
   * Filtering on `remaining_quantity > 0` is load-bearing — filtering on
   * `inventory_lots.quantity` here would include fully-allocated lots
   * (the base column is the received, not remaining, quantity). See
   * supabase/migrations/00172_revert_expiring_active_index.sql for the
   * full reasoning.
   *
   * @param limit Optional cap on result rows. Pass for paginated UIs
   *   (e.g. the inventory dashboard) where you only render the next N
   *   expirations.
   */
  async getExpiringLots(
    supabase: SupabaseClient<Database>,
    daysAhead: number = 30,
    limit?: number
  ): Promise<ServiceResult<ExpiringLot[]>> {
    try {
      // Advance with the UTC setters, not local getDate()/setDate() — mixing
      // local-time arithmetic with the UTC toISOString() read below shifts
      // the result by a day whenever the addition spans a DST transition
      // (host-timezone dependent). Same rule as
      // src/domain/purchasing/po-generator.ts's expected_date calculation.
      const cutoff = new Date();
      cutoff.setUTCDate(cutoff.getUTCDate() + daysAhead);
      const cutoffStr = cutoff.toISOString().split("T")[0];

      let query = dynamicFrom(supabase, "inventory_lots_with_quantities")
        .select("id, lot_number, remaining_quantity, unit, expiration_date, location, item:inventory_items(name)")
        .not("expiration_date", "is", null)
        .lte("expiration_date", cutoffStr)
        .gt("remaining_quantity", 0)
        .order("expiration_date", { ascending: true });

      if (limit !== undefined) {
        query = query.limit(limit);
      }

      const { data, error } = await query;

      if (error) {
        return err(parseSupabaseError(error, { table: "inventory_lots_with_quantities" }));
      }

      const now = new Date();
      now.setUTCHours(0, 0, 0, 0);
      const lots: ExpiringLot[] = (data ?? []).map((lot: Record<string, unknown>) => {
        const expDate = new Date(lot.expiration_date as string);
        const diffTime = expDate.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const item = lot.item as { name: string } | null;

        return {
          id: lot.id as string,
          item_name: item?.name ?? "Unknown",
          lot_number: lot.lot_number as string,
          remaining_quantity: lot.remaining_quantity as number,
          unit: lot.unit as string,
          expiration_date: lot.expiration_date as string,
          days_until_expiry: diffDays,
          location_name: (lot.location as string) ?? null,
        };
      });

      return ok(lots);
    } catch (e) {
      return err({
        code: "UNKNOWN",
        message: `Failed to get expiring lots: ${e instanceof Error ? e.message : String(e)}`,
        cause: e,
      });
    }
  },
};
