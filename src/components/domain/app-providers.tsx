"use client";

/**
 * App Providers
 *
 * Client providers for authenticated app routes.
 * Includes notifications, sidebar state, and other authenticated-only contexts.
 */

import type { ReactNode } from "react";
import { NotificationsProvider } from "@/contexts/notifications";
import { SidebarProvider } from "@/contexts/sidebar";

interface AppProvidersProps {
  children: ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  return (
    <SidebarProvider>
      <NotificationsProvider>{children}</NotificationsProvider>
    </SidebarProvider>
  );
}
