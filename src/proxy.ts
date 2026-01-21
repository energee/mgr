/**
 * Next.js 16 Proxy
 *
 * Replaces deprecated middleware. Only handles session refresh.
 * Auth redirects are handled by layouts (CVE-2025-29927).
 */

import { type NextRequest } from "next/server";
import { refreshSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return await refreshSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder assets
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
