/**
 * Reorder / Duplicate Order domain logic.
 *
 * Orders cannot ride the framework Duplicate action
 * (EntityConfig.excludeOnDuplicate → prefilled /new form) because line items
 * live in the order_items child table, which is only editable post-create
 * (the Items tab is hidden on the create form). Instead, duplicateOrder()
 * programmatically inserts a complete draft copy:
 *
 * - header: status = draft, order_date = today, fresh `{base}-R{n}` order
 *   number (orders.order_number is UNIQUE), customer + notes carried over;
 *   delivery dates and fulfillment fields deliberately do NOT carry over
 * - line items: brand/format/keg owner/style/quantity copied, unit prices
 *   re-resolved through the shared pricing service
 *   (@/services/pricing-service) so the copy reflects current tier pricing
 *   (falls back to the source price when no tier price resolves); allocation
 *   fields (batch_id, package_id) never carry over
 *
 * Surfaced as the "Duplicate Order" action on order detail / list rows
 * (src/entities/order.tsx) and the "Reorder last" button on the customer
 * Orders tab (customer-orders-relation.tsx) via useReorderOrder().
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Database } from "@/types/supabase";
import { createClient } from "@/lib/supabase/client";
import { orderKeys } from "@/lib/query-keys";
import { parseUnknownError } from "@/lib/errors";
import { localDateString } from "@/lib/format";
import { getPriceForCustomer } from "@/services/pricing-service";

type Client = SupabaseClient<Database>;

/** Line-item fields that carry over to the duplicated draft. */
type SourceItem = {
  brand_id: string | null;
  selling_format_id: string | null;
  keg_owner_id: string | null;
  style_id: string | null;
  quantity: number;
  unit_price: number | null;
};

/** Postgres unique_violation — used to retry with the next -R{n} suffix. */
const UNIQUE_VIOLATION = "23505";

/** Matches the `-R{n}` suffix appended to duplicated order numbers. */
const REORDER_SUFFIX_RE = /-R(\d+)$/;

/**
 * Escapes an order-number prefix for a PostgREST `.like()` probe.
 *
 * Unlike `escapeIlikePattern`, `*` is deliberately left alone: PostgREST
 * rewrites `*` to `%` with no escape syntax, so escaping it would yield a
 * literal-`%` pattern that matches nothing. Here "no match" is NOT a safe
 * default — an empty `taken` list makes `nextDuplicateOrderNumber` hand back an
 * order number that already exists. Letting `*` widen to `%` over-matches
 * instead, which is harmless because `nextDuplicateOrderNumber` re-checks each
 * row with `startsWith(base)`.
 */
function escapeLikePrefix(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Max header-insert attempts when racing another duplicate for a suffix. */
const MAX_NUMBER_ATTEMPTS = 3;

/**
 * Compute the next order number for a duplicate: `{base}-R{n}`, where base is
 * the source number minus any existing `-R{n}` suffix (so duplicating a
 * duplicate keeps one suffix) and n is one more than the highest suffix
 * already present in `existingNumbers`.
 */
export function nextDuplicateOrderNumber(
  sourceNumber: string,
  existingNumbers: string[]
): string {
  const base = sourceNumber.replace(REORDER_SUFFIX_RE, "");
  let max = 0;
  for (const num of existingNumbers) {
    if (!num.startsWith(base)) continue;
    const match = num.slice(base.length).match(/^-R(\d+)$/);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return `${base}-R${max + 1}`;
}


/**
 * Re-resolve a copied line item's unit price at current tier pricing through
 * the shared pricing service (the same lookup the order items editor uses).
 * Falls back to the source item's price whenever no price resolves — the order
 * has no customer, the item has no selling format, the customer has no tier
 * price for that format, or the lookup errored (a pricing outage must not
 * block the reorder; the service logs it and reports null).
 */
async function resolveUnitPrice(
  supabase: Client,
  customerId: string | null,
  item: SourceItem
): Promise<number | null> {
  const tierPrice = await getPriceForCustomer(supabase, {
    customerId,
    sellingFormatId: item.selling_format_id,
    brandId: item.brand_id,
    styleId: item.style_id,
  });
  return tierPrice?.price ?? item.unit_price;
}

/**
 * Insert the draft header with a fresh `{base}-R{n}` order number; on a
 * unique-violation race (another duplicate grabbed the same suffix between
 * our read and write), bump the suffix and retry.
 */
async function insertDraftHeader(
  supabase: Client,
  source: { order_number: string; customer_id: string | null; notes: string | null },
  taken: string[]
): Promise<{ id: string; orderNumber: string }> {
  let orderNumber = nextDuplicateOrderNumber(source.order_number, taken);
  for (let attempt = 1; ; attempt++) {
    const { data: created, error: insertError } = await supabase
      .from("orders")
      .insert({
        order_number: orderNumber,
        customer_id: source.customer_id,
        status: "draft",
        order_date: localDateString(),
        notes: source.notes,
      })
      .select("id")
      .single();
    if (!insertError) return { id: created.id, orderNumber };
    if (insertError.code === UNIQUE_VIOLATION && attempt < MAX_NUMBER_ATTEMPTS) {
      taken.push(orderNumber);
      orderNumber = nextDuplicateOrderNumber(source.order_number, taken);
      continue;
    }
    throw insertError;
  }
}

/**
 * Duplicate an order as a new draft (see module comment for what carries
 * over). Returns the new order's id and generated order number. If copying
 * the line items fails, the just-created header is deleted so no empty draft
 * is left behind.
 */
export async function duplicateOrder(
  supabase: Client,
  sourceOrderId: string
): Promise<{ id: string; orderNumber: string }> {
  // Source header + line items
  const { data: source, error: sourceError } = await supabase
    .from("orders")
    .select("id, order_number, customer_id, notes")
    .eq("id", sourceOrderId)
    .single();
  if (sourceError) throw sourceError;

  const { data: sourceItems, error: itemsError } = await supabase
    .from("order_items")
    .select("brand_id, selling_format_id, keg_owner_id, style_id, quantity, unit_price")
    .eq("order_id", sourceOrderId)
    .order("created_at", { ascending: true });
  if (itemsError) throw itemsError;

  // Fresh order number: find suffixes already taken for this base
  const base = source.order_number.replace(REORDER_SUFFIX_RE, "");
  const { data: takenRows, error: takenError } = await supabase
    .from("orders")
    .select("order_number")
    .like("order_number", `${escapeLikePrefix(base)}-R%`);
  if (takenError) throw takenError;
  const taken = (takenRows ?? []).map((r) => r.order_number);

  const { id: newId, orderNumber } = await insertDraftHeader(supabase, source, taken);

  // Copy line items with prices re-resolved at current tier pricing
  try {
    const items = await Promise.all(
      (sourceItems ?? []).map(async (item) => ({
        order_id: newId,
        brand_id: item.brand_id,
        selling_format_id: item.selling_format_id,
        keg_owner_id: item.keg_owner_id,
        style_id: item.style_id,
        quantity: item.quantity,
        unit_price: await resolveUnitPrice(supabase, source.customer_id, item),
      }))
    );
    if (items.length > 0) {
      const { error: copyError } = await supabase.from("order_items").insert(items);
      if (copyError) throw copyError;
    }
  } catch (err) {
    // Don't leave an empty draft behind — remove the header we just created.
    await supabase.from("orders").delete().eq("id", newId);
    throw err;
  }

  return { id: newId, orderNumber };
}

/**
 * Mutation hook around duplicateOrder for React surfaces (customer Orders
 * tab): invalidates order caches (the ["orders"] prefix also covers the
 * relation-table key ["orders", "by", "customer_id", id]), toasts, and
 * navigates to the new draft. The order entity action uses duplicateOrder
 * directly — entity configs run outside React, with no client router.
 */
export function useReorderOrder() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sourceOrderId: string) => duplicateOrder(createClient(), sourceOrderId),
    onSuccess: ({ id, orderNumber }) => {
      queryClient.invalidateQueries({ queryKey: orderKeys.all() });
      toast.success(`Draft order ${orderNumber} created`);
      router.push(`/sales/orders/${id}`);
    },
    onError: (err) => {
      toast.error(parseUnknownError(err).message);
    },
  });
}
