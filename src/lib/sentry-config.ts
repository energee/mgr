/**
 * Shared Sentry configuration used by client, server, and edge entry points.
 *
 * Next.js requires separate Sentry init files for each runtime, but
 * the base config values are identical across all three.
 */
export const sentryBaseConfig = {
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  sendDefaultPii: false,
} as const;
