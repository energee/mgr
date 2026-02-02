"use client";

/**
 * App Providers
 *
 * Client providers for authenticated app routes.
 * Includes notifications, keyboard shortcuts, and other authenticated-only contexts.
 */

import type { ReactNode } from "react";
import { NotificationsProvider } from "@/contexts/notifications";
import { KeyboardShortcutsProvider } from "@/components/domain/keyboard-shortcuts-provider";

interface AppProvidersProps {
  children: ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  return (
    <NotificationsProvider>
      <KeyboardShortcutsProvider>{children}</KeyboardShortcutsProvider>
    </NotificationsProvider>
  );
}
