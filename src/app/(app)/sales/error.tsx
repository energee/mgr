"use client";

/** Sales routes error boundary. */

import { RouteError } from "@/components/universal/route-error";

export default function SalesError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} domain="sales" />;
}
