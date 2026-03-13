"use client";

/** Dashboard routes error boundary. */

import { RouteError } from "@/components/universal/route-error";

export default function DashboardError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} domain="dashboard" />;
}
