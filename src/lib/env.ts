/**
 * Shared environment variable helpers.
 *
 * Centralizes env var access patterns used across multiple API routes
 * to prevent drift between duplicate definitions.
 * Also validates required Supabase env vars at import time.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Validated environment variables
// ---------------------------------------------------------------------------

const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

/**
 * Client-safe env vars (NEXT_PUBLIC_* prefix).
 * Validated at import time — throws on missing vars.
 * Set SKIP_ENV_VALIDATION=1 to bypass (e.g. during `next build` without env vars).
 */
export const clientEnv = process.env.SKIP_ENV_VALIDATION
  ? (process.env as unknown as z.infer<typeof clientEnvSchema>)
  : clientEnvSchema.parse({
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    });

/**
 * The Supabase project URL that every server-side Supabase client in this app
 * is built from (see `src/lib/supabase/server.ts`).
 *
 * Exists so that a security gate which needs to know *which database is about
 * to be touched* can resolve it through the same accessor the clients use,
 * rather than reading `process.env.NEXT_PUBLIC_SUPABASE_URL` itself. The two
 * are NOT equivalent: `NEXT_PUBLIC_*` is inlined by the bundler at build time,
 * so a direct read in application code compiles to the build machine's literal,
 * whereas `clientEnv` returns the live `process.env` whenever
 * `SKIP_ENV_VALIDATION` is set at runtime (`package.json`'s `build` script sets
 * it). Mixing the two styles in one request path lets a gate and a client
 * disagree about the target database — see
 * `src/app/api/auth/dev-login/route.ts`, where that disagreement was a bypass.
 *
 * The return type follows `clientEnv`, which under `SKIP_ENV_VALIDATION` is an
 * unvalidated cast of `process.env`. A caller that must fail closed on a
 * missing value should therefore still check for one.
 */
export function getSupabaseUrl(): string {
  return clientEnv.NEXT_PUBLIC_SUPABASE_URL;
}

/**
 * Server-only env vars. Call from server components, API routes,
 * and server actions only — never from client components.
 */
export function getServerEnv() {
  if (typeof window !== "undefined") {
    throw new Error("getServerEnv() must not be called in client-side code");
  }
  return serverEnvSchema.parse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
}

// ---------------------------------------------------------------------------
// Other helpers
// ---------------------------------------------------------------------------

/** Base URL for invite redirects and magic-link callbacks. */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  (() => {
    if (process.env.NODE_ENV === "production") {
      // eslint-disable-next-line no-console -- env.ts loads before logger is available
      console.warn("[env] WARNING: NEXT_PUBLIC_SITE_URL is not set. Invite redirects will use localhost:3000.");
    }
    return "http://localhost:3000";
  })();
