/**
 * Supabase Client (Browser)
 *
 * Creates a Supabase client for use in client components.
 * Uses @supabase/ssr for proper cookie handling with Next.js.
 */

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/supabase";
import { clientEnv } from "@/lib/env";

type BrowserClient = ReturnType<typeof createBrowserClient<Database>>;

// Module-scoped singleton. Every call site across the app previously got a
// brand new GoTrueClient bound to the same auth storage key, so concurrent
// instances raced over the same navigator.locks name — one instance's lock
// acquisition would "steal" the lock from another's in-flight
// supabase.auth.getSession()/getUser() call, aborting it with
// "AbortError: Lock broken by another request with the 'steal' option."
// (see SENTRY-7597067722). Reusing one client per browser session avoids the
// race entirely.
let browserClient: BrowserClient | undefined;

/**
 * Create (or reuse) the Supabase client for client-side use.
 * Call this in client components.
 */
export function createClient() {
  if (!browserClient) {
    browserClient = createBrowserClient<Database>(
      clientEnv.NEXT_PUBLIC_SUPABASE_URL,
      clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
  }
  return browserClient;
}
