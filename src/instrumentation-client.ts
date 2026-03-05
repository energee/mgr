/**
 * Sentry client-side instrumentation.
 * Initializes Sentry in the browser for error tracking and performance monitoring.
 * Loaded automatically by Next.js via the instrumentation-client convention.
 */
import * as Sentry from "@sentry/nextjs";
import { sentryBaseConfig } from "@/lib/sentry-config";

Sentry.init({
  ...sentryBaseConfig,

  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  integrations: [Sentry.replayIntegration()],
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
