/**
 * Sentry client-side configuration.
 * Initializes Sentry in the browser for client-side error tracking.
 */
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  // Only send errors when a DSN is configured
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Sample 10% of transactions in production, 100% in development
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // Don't send personally identifiable information
  sendDefaultPii: false,
});
