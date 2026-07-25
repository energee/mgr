"use client";

/** Error boundary for the customer portal routes. */

import { RouteError } from "@/components/universal/route-error";

export default function PortalError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} domain="portal" />;
}
