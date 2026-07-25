"use client";

/** Fallback error boundary for the authenticated app routes. */

import { RouteError } from "@/components/universal/route-error";

export default function AppError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} domain="app" />;
}
