/**
 * Sales Order Number Generator
 *
 * Client-side wrapper for the race-safe generate_next_order_number() Postgres
 * function (migration 00186) — the sales-side sibling of generateNextPONumber
 * (src/domain/purchasing/po-generator.ts). Used by /sales/orders/new to
 * prefill order_number with the next suggestion in the ORD-YYYY-NNN sequence;
 * the field stays editable and the orders.order_number UNIQUE constraint
 * backstops concurrent suggestions at save time.
 */

import { log } from "@/lib/client-logger";

/** Lazy-import supabase client to avoid env validation at module load time. */
async function getSupabase() {
  const { createClient } = await import("@/lib/supabase/client");
  return createClient();
}

/**
 * Generates the next sales order number using the race-safe database
 * function (pg_advisory_xact_lock serializes concurrent callers).
 * Returns numbers in ORD-YYYY-NNN format.
 */
export async function generateNextOrderNumber(): Promise<string> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("generate_next_order_number");

  if (error) {
    log.error("Error generating order number:", error);
    throw error;
  }

  return data;
}
