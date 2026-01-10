/**
 * Supabase Client (Browser)
 *
 * Creates a Supabase client for use in client components.
 * Uses @supabase/ssr for proper cookie handling with Next.js.
 */

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/supabase";

/**
 * Create a Supabase client for client-side use.
 * Call this in client components.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
