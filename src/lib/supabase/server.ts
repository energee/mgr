/**
 * Supabase Client (Server)
 *
 * Creates a Supabase client for use in Server Components, Route Handlers,
 * and Server Actions. Uses @supabase/ssr for proper cookie handling.
 */

import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "@/types/supabase";
import { clientEnv, getServerEnv, getSupabaseUrl } from "@/lib/env";

/**
 * Create a Supabase client for server-side use.
 * Call this in Server Components, Route Handlers, or Server Actions.
 *
 * The project URL comes from `getSupabaseUrl()` rather than a direct
 * `process.env` read so that gates guarding these clients can resolve the same
 * value — see that function's docstring.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    getSupabaseUrl(),
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing sessions.
          }
        },
      },
    }
  );
}

/**
 * Create a Supabase admin client with service role key.
 * Use sparingly - bypasses RLS.
 *
 * Uses @supabase/supabase-js directly (no cookie binding) so the service role
 * key is the sole auth credential and RLS is truly bypassed.
 *
 * The project URL comes from `getSupabaseUrl()`. Routes that gate on *which*
 * database this client would reach (`src/app/api/auth/dev-login/route.ts`) read
 * the same accessor, so gate and client cannot resolve different targets.
 */
export async function createAdminClient() {
  const { SUPABASE_SERVICE_ROLE_KEY } = getServerEnv();
  return createSupabaseClient<Database>(
    getSupabaseUrl(),
    SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
}
