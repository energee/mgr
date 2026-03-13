"use client";

/** Purchasing routes error boundary. */

import { RouteError } from "@/components/universal/route-error";

export default function PurchasingError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} domain="purchasing" />;
}
