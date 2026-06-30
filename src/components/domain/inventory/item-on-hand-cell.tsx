"use client";

/**
 * ItemOnHandCell - "On Hand" cell for the Inventory Items list (audit
 * finding 27: the list showed no quantities, so counters had to open each
 * item's lots and sum rows mentally).
 *
 * One shared TanStack Query (inventoryKeys.itemOnHand) fetches every lot's
 * remaining_quantity from inventory_lots_with_quantities and aggregates it
 * per item; each cell then reads its item's total from the cached map, so
 * the whole column costs a single request per table render.
 */

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { inventoryKeys } from "@/lib/query-keys";
import { formatSmartDecimal } from "@/lib/format";

/** Sum lot remaining quantities per inventory item. */
function aggregateOnHand(
  rows: Array<{ inventory_item_id: string | null; remaining_quantity: number | null }>
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    if (!row.inventory_item_id) continue;
    totals[row.inventory_item_id] =
      (totals[row.inventory_item_id] ?? 0) + (row.remaining_quantity ?? 0);
  }
  return totals;
}

export function ItemOnHandCell({
  itemId,
  unit,
}: {
  itemId: string;
  unit?: string | null;
}) {
  const supabase = createClient();

  const { data: totals, isLoading } = useQuery({
    queryKey: inventoryKeys.itemOnHand(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_lots_with_quantities")
        .select("inventory_item_id, remaining_quantity");
      if (error) throw error;
      return aggregateOnHand(data ?? []);
    },
  });

  if (isLoading) return <Skeleton className="h-4 w-12" />;

  const onHand = totals?.[itemId] ?? 0;
  return (
    <span className={onHand <= 0 ? "text-muted-foreground" : undefined}>
      {formatSmartDecimal(onHand, 3)}
      {unit ? ` ${unit}` : ""}
    </span>
  );
}
