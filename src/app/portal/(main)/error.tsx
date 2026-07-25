"use client";

/** Error boundary for the customer portal routes. */

import { RouteError } from "@/components/universal/route-error";

export default function PortalError(props: { error: Error & { digest?: string }; reset: () => void }) {
  // Portal customers have no access to the staff app root — send them to /portal.
  return <RouteError {...props} domain="portal" homeHref="/portal" />;
}
