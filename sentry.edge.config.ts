/**
 * Sentry edge runtime configuration.
 * Initializes Sentry in edge functions for error tracking.
 */
import * as Sentry from "@sentry/nextjs";
import { sentryBaseConfig } from "./src/lib/sentry-config";

Sentry.init({
  ...sentryBaseConfig,
});
