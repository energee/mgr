"use client";

/** Settings routes error boundary. */

import { RouteError } from "@/components/universal/route-error";

export default function SettingsError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} domain="settings" />;
}
