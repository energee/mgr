/**
 * Supabase Proxy Helpers
 *
 * Handles session refresh only. Auth redirects are handled by layouts.
 * Called by Next.js proxy on every request.
 *
 * Note: Next.js 16 deprecated middleware in favor of proxy.
 * Auth checks should be in layouts, not proxy (CVE-2025-29927).
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/supabase";

/**
 * Refresh the Supabase session.
 * Only handles token refresh - auth redirects are in layouts.
 */
export async function refreshSession(request: NextRequest) {
  let response = NextResponse.next({
    request,
  });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session - this updates cookies if token is refreshed
  await supabase.auth.getUser();

  return response;
}
