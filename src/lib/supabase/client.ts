/**
 * Supabase Client (Browser)
 *
 * Creates a Supabase client for use in client components.
 * Uses @supabase/ssr for proper cookie handling with Next.js.
 */

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/supabase";
import { clientEnv } from "@/lib/env";

/**
 * Create a Supabase client for client-side use.
 * Call this in client components.
 */
export function createClient() {
  return createBrowserClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
