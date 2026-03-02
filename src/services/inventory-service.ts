/**
 * Inventory Domain Service
 *
 * Wraps inventory-specific RPC functions (overview, expiring lots)
 * in the ServiceResult pattern. Consolidates logic previously duplicated
 * between AI chat tools and the inventory-alerts component.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { type ServiceResult, ok, err, parseSupabaseError } from "./types";

/** Result from the get_inventory_overview RPC function. */
export interface InventoryOverview {
  finished_goods: Array<{
    brand_name: string;
    package_type_name: string;
    available_quantity: number;
    committed_quantity: number;
    total_quantity: number;
  }>;
  batches_in_progress: Array<{
    batch_number: string;
    recipe_name: string;
    status: string;
    volume_bbl: number;
  }>;
  low_stock_items: Array<{
    item_name: string;
    current_quantity: number;
    min_quantity: number;
    unit: string;
  }>;
}

/** An inventory lot approaching expiration. */
export interface ExpiringLot {
  id: string;
  item_name: string;
  lot_number: string;
  quantity: number;
  unit: string;
  expiration_date: string;
  days_until_expiry: number;
  location_name: string | null;
}

export const inventoryService = {
  /**
   * Get a comprehensive inventory overview including finished goods,
   * batches in progress, and low stock items.
   * Wraps the `get_inventory_overview` RPC function.
   */
  async getOverview(
    supabase: SupabaseClient<Database>
  ): Promise<ServiceResult<InventoryOverview>> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)("get_inventory_overview");

      if (error) {
        return err(parseSupabaseError(error));
      }

      return ok(data as InventoryOverview);
    } catch (e) {
      return err({
        code: "UNKNOWN",
        message: `Failed to get inventory overview: ${e instanceof Error ? e.message : String(e)}`,
        cause: e,
      });
    }
  },

  /**
   * Get inventory lots expiring within the specified number of days.
   */
  async getExpiringLots(
    supabase: SupabaseClient<Database>,
    daysAhead: number = 30
  ): Promise<ServiceResult<ExpiringLot[]>> {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + daysAhead);
      const cutoffStr = cutoff.toISOString().split("T")[0];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;

      const { data, error } = await db
        .from("inventory_lots")
        .select("id, lot_number, quantity, unit, expiration_date, item:inventory_items(name), location:locations(name)")
        .not("expiration_date", "is", null)
        .lte("expiration_date", cutoffStr)
        .gt("quantity", 0)
        .order("expiration_date", { ascending: true });

      if (error) {
        return err(parseSupabaseError(error, { table: "inventory_lots" }));
      }

      const now = new Date();
      const lots: ExpiringLot[] = (data ?? []).map((lot: Record<string, unknown>) => {
        const expDate = new Date(lot.expiration_date as string);
        const diffTime = expDate.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const item = lot.item as { name: string } | null;
        const location = lot.location as { name: string } | null;

        return {
          id: lot.id as string,
          item_name: item?.name ?? "Unknown",
          lot_number: lot.lot_number as string,
          quantity: lot.quantity as number,
          unit: lot.unit as string,
          expiration_date: lot.expiration_date as string,
          days_until_expiry: diffDays,
          location_name: location?.name ?? null,
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
