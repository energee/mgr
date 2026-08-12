"use client";

/**
 * usePickListForOrder — resolve an order's active (non-cancelled) formal pick
 * list, if any.
 *
 * Single source for the `pick_lists`-by-order lookup so the query key
 * (pickListKeys.forOrder) and the row shape stay identical across call sites
 * (order quick links, the order pick-list route) and the result is shared via
 * the React Query cache.
 */

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { unwrap } from "@/lib/supabase/query-helpers";
import { pickListKeys } from "@/lib/query-keys";

/** Minimal pick list reference: enough to link to it and gate UI by status. */
export type PickListRef = { id: string; status: string };

export function usePickListForOrder(orderId: string) {
  const supabase = createClient();

  return useQuery({
    queryKey: pickListKeys.forOrder(orderId),
    queryFn: async () => {
      return (await unwrap(
        supabase
          .from("pick_lists")
          .select("id, status")
          .eq("order_id", orderId)
          .neq("status", "cancelled")
          .limit(1)
          .maybeSingle()
      )) as PickListRef | null;
    },
  });
}
