/**
 * Next.js instrumentation hook.
 * Registers Sentry for server-side and edge runtimes.
 * See: https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 */
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
