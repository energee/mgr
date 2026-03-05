/**
 * Sentry server-side configuration.
 * Initializes Sentry in the Node.js runtime for server-side error tracking.
 */
import * as Sentry from "@sentry/nextjs";
import { sentryBaseConfig } from "./src/lib/sentry-config";

Sentry.init({
  ...sentryBaseConfig,
});
