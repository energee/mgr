/**
 * Customer-tier pricing service.
 *
 * Single entry point for the customer-tier half of the dual pricing model: it
 * wraps the `get_price_for_customer` Postgres function
 * (supabase/migrations/00214_capture_get_price_for_customer.sql), which
 * resolves the customer's price tier + sales channel and reads the
 * tier x format x channel cell from `pricing_tier_prices`.
 *
 * The RPC call used to be issued straight from React — once in the order items
 * editor and once in the reorder/duplicate path — so "how do I price a line for
 * this customer?" was answerable only by reading component code. Both callers
 * now go through here; this file is React-free and callable from a route
 * handler or an AI tool.
 *
 * Not fully framework-free, though: the error path logs through
 * `@/lib/client-logger`, which pulls in `@sentry/nextjs`. That makes this the
 * only module in `src/services/` carrying a Next-flavoured dependency. Fine
 * for anything running inside the app; a plain Node script would need that
 * logger swapped for `@/lib/logger` or injected. Noted so the next caller does
 * not discover it the hard way.
 *
 * Semantics deliberately preserved from those two call sites:
 * - No customer or no selling format => `null`, with **no RPC round trip**.
 * - The RPC returning no row (customer has no tier or no channel, or the
 *   tier x format x channel cell is empty) => `null`. That is a normal outcome,
 *   not an error: auto-pricing simply no-ops.
 * - An RPC error or thrown exception is logged and also reported as `null`, so
 *   a pricing outage degrades to "no suggested price" instead of failing the
 *   surrounding operation (adding a line, duplicating an order).
 *
 * One behavior was reconciled when the two copies merged: the editor wrapped
 * the call in try/catch, the reorder path did not, so a *thrown* client error
 * (as opposed to an `{ error }` result) used to abort the duplicate instead of
 * falling back. Both now fall back, which is what the reorder path's own
 * comment already claimed it did. supabase-js resolves `.rpc()` with
 * `{ data, error }` rather than rejecting, so this path is not reachable in
 * normal operation.
 *
 * `brandId` / `styleId` are accepted because the RPC signature takes them, but
 * the live function ignores them (the 00077 redesign dropped the brand/style
 * and temporal dimensions). They are forwarded verbatim so a future
 * reinstatement needs no caller change.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { log } from "@/lib/client-logger";

type Client = SupabaseClient<Database>;

/** One resolved tier price, as returned by `get_price_for_customer`. */
export type TierPrice = {
  price: number;
  tier_name: string;
  is_brand_specific: boolean;
  is_style_specific: boolean;
};

export type GetPriceForCustomerParams = {
  customerId: string | null | undefined;
  sellingFormatId: string | null | undefined;
  brandId?: string | null;
  styleId?: string | null;
};

/**
 * Resolve the tier price for a customer/selling-format pair.
 *
 * Returns `null` whenever no price can be resolved — including on error (see
 * the module comment). Callers decide the fallback: the order items editor
 * shows no suggestion, the reorder path keeps the source line's price.
 */
export async function getPriceForCustomer(
  supabase: Client,
  { customerId, sellingFormatId, brandId, styleId }: GetPriceForCustomerParams
): Promise<TierPrice | null> {
  if (!customerId || !sellingFormatId) return null;

  try {
    const { data, error } = await supabase.rpc("get_price_for_customer", {
      p_customer_id: customerId,
      p_format_id: sellingFormatId,
      // Omitted (rather than sent as null) when absent: the RPC declares both
      // as `DEFAULT NULL`, so omitting and passing NULL are the same call, and
      // omitting is what the generated Args type allows. `||` (not `??`) so an
      // empty-string id from a cleared form field is treated as absent rather
      // than as an id that matches nothing.
      p_brand_id: brandId || undefined,
      p_style_id: styleId || undefined,
    });

    if (error) {
      log.error("Tier price lookup failed:", error);
      return null;
    }

    return data && data.length > 0 ? (data[0] as TierPrice) : null;
  } catch (e) {
    log.error("Tier price lookup threw:", e);
    return null;
  }
}
