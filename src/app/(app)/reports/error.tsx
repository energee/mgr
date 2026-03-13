"use client";

/** Reports routes error boundary. */

import { RouteError } from "@/components/universal/route-error";

export default function ReportsError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} domain="report" />;
}
