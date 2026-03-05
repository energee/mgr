/**
 * Sentry server-side configuration.
 * Initializes Sentry in the Node.js runtime for server-side error tracking.
 */
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // Don't send personally identifiable information
  sendDefaultPii: false,
});
