"use client";

/**
 * App Providers
 *
 * Client providers for authenticated app routes.
 * Includes notifications and other authenticated-only contexts.
 */

import type { ReactNode } from "react";
import { NotificationsProvider } from "@/contexts/notifications";

interface AppProvidersProps {
  children: ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  return <NotificationsProvider>{children}</NotificationsProvider>;
}
