"use client";

/**
 * App Providers
 *
 * Client providers for authenticated app routes.
 * Includes notifications, keyboard shortcuts, and other authenticated-only contexts.
 */

import { type ReactNode, useEffect } from "react";
import { NotificationsProvider } from "@/contexts/notifications";
import { KeyboardShortcutsProvider } from "@/components/domain/keyboard-shortcuts-provider";
import { ChatProvider } from "@/contexts/chat-context";
import { createClient } from "@/lib/supabase/client";

interface AppProvidersProps {
  children: ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  useEffect(() => {
    createClient()
      .rpc("update_last_active")
      .catch((err: unknown) => {
        if (process.env.NODE_ENV === "development") {
          console.warn("update_last_active failed:", err);
        }
      });
  }, []);

  return (
    <NotificationsProvider>
      <KeyboardShortcutsProvider>
        <ChatProvider>{children}</ChatProvider>
      </KeyboardShortcutsProvider>
    </NotificationsProvider>
  );
}
