"use client";

/** Production routes error boundary. */

import { RouteError } from "@/components/universal/route-error";

export default function ProductionError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} domain="production" />;
}
