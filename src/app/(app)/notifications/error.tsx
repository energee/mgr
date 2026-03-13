"use client";

/** Notifications routes error boundary. */

import { RouteError } from "@/components/universal/route-error";

export default function NotificationsError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} domain="notification" />;
}
