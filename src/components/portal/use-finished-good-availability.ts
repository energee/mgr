/**
 * Shared finished-goods availability for the customer portal.
 *
 * Both portal write surfaces cap what a customer may ask for against the same
 * number — the unallocated quantity behind `get_portal_available_products()`
 * (migration 00292), which aggregates `finished_goods_with_availability` per
 * (brand, selling format). It is read through that definer-rights RPC rather
 * than the view directly: the view is SECURITY INVOKER over a table gated on
 * `inventory:read`, a permission the 'customer' role does not hold, so
 * selecting it as a portal customer returned zero rows and silently emptied
 * both pickers.
 *
 *   - `change-request-builder.tsx` caps a proposed line at
 *     `originalQuantity + available` (the quantity already reserved for that
 *     line is not competing with itself), and
 *   - `order-builder.tsx` caps a brand-new line at `available`.
 *
 * The query, the composite (brand, selling format) lookup key and the map were
 * duplicated in the two components before Phase 4 node C2. They live here
 * instead so the two surfaces cannot drift apart on which rows count as
 * available — the `.gt("available_quantity", 0)` filter in particular.
 *
 * Availability is advisory, not a guarantee: it is read at page load and staff
 * confirm the order later, so the authoritative check is the allocation step.
 * This exists to keep a customer from ordering ten pallets of something with
 * one case in stock, not to reserve anything.
 */
"use client";

import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { dynamicRpc } from "@/services/types";
import { unwrap } from "@/lib/supabase/query-helpers";
import { inventoryKeys } from "@/lib/query-keys";

/** One row as `get_portal_available_products()` (00292) returns it. */
type PortalAvailableProduct = {
  brand_id: string;
  brand_name: string;
  selling_format_id: string | null;
  selling_format_name: string | null;
  available_quantity: number;
};

/** One sellable (brand x selling format) pair with unallocated stock. */
export type FinishedGoodAvailability = {
  brand_id: string;
  selling_format_id: string | null;
  available_quantity: number;
  brands: { id: string; name: string } | null;
  selling_formats: { id: string; name: string } | null;
};

/**
 * Composite lookup key for a (brand, selling format) pair.
 *
 * A missing selling format collapses to the empty string rather than being
 * dropped, so `brand|` and `brand|format` stay distinct buckets.
 */
export function availabilityKey(
  brandId: string,
  sellingFormatId?: string | null
): string {
  return `${brandId}|${sellingFormatId ?? ""}`;
}

export type FinishedGoodAvailabilityResult = {
  /** Rows with stock left, or `undefined` while the query is in flight. */
  availableGoods: FinishedGoodAvailability[] | undefined;
  isLoading: boolean;
  /** Unallocated quantity for a pair; `0` for anything not in stock. */
  getAvailable: (brandId: string, sellingFormatId?: string | null) => number;
};

export function useFinishedGoodAvailability(): FinishedGoodAvailabilityResult {
  const supabase = createClient();

  const { data: availableGoods, isLoading } = useQuery<
    FinishedGoodAvailability[]
  >({
    queryKey: inventoryKeys.finishedGoodsAvailable(),
    queryFn: async () => {
      // Read through the RPC, not the view. `finished_goods_with_availability`
      // is SECURITY INVOKER over a table gated on `inventory:read`, which the
      // 'customer' role does not hold — selecting it as a portal customer
      // returns zero rows, which silently emptied this list on both portal
      // surfaces. `get_portal_available_products` (00292) is SECURITY DEFINER
      // and exposes only brand/format identity plus a count.
      const rows = (await unwrap(
        dynamicRpc(supabase, "get_portal_available_products")
      )) as unknown as PortalAvailableProduct[];

      // Re-nest into the view's shape so both consumers stay unchanged.
      return rows.map((row) => ({
        brand_id: row.brand_id,
        selling_format_id: row.selling_format_id,
        available_quantity: row.available_quantity,
        brands: { id: row.brand_id, name: row.brand_name },
        selling_formats: row.selling_format_id
          ? { id: row.selling_format_id, name: row.selling_format_name ?? "" }
          : null,
      }));
    },
  });

  const availabilityMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const fg of availableGoods ?? []) {
      map.set(
        availabilityKey(fg.brand_id, fg.selling_format_id),
        fg.available_quantity
      );
    }
    return map;
  }, [availableGoods]);

  const getAvailable = useCallback(
    (brandId: string, sellingFormatId?: string | null) =>
      availabilityMap.get(availabilityKey(brandId, sellingFormatId)) ?? 0,
    [availabilityMap]
  );

  return { availableGoods, isLoading, getAvailable };
}
