"use client";

/**
 * App Providers
 *
 * Client providers for authenticated app routes.
 * Includes notifications, keyboard shortcuts, and other authenticated-only contexts.
 */

import { type ReactNode, useEffect } from "react";
import { NotificationsProvider } from "@/contexts/notifications";
import { PermissionProvider } from "@/contexts/permissions";
import { KeyboardShortcutsProvider } from "@/components/domain/keyboard-shortcuts-provider";
import { ChatProvider } from "@/contexts/chat-context";
import { createClient } from "@/lib/supabase/client";
import type { UserRole } from "@/lib/permissions";
import { log } from "@/lib/client-logger";

type AppProvidersProps = {
  roles: UserRole[];
  children: ReactNode;
}

export function AppProviders({ roles, children }: AppProvidersProps) {
  useEffect(() => {
    createClient()
      .rpc("update_last_active")
      .then(({ error }) => {
        if (error && process.env.NODE_ENV === "development") {
          log.warn("update_last_active failed:", error);
        }
      });
  }, []);

  return (
    <PermissionProvider roles={roles}>
      <NotificationsProvider>
        <KeyboardShortcutsProvider>
          <ChatProvider>{children}</ChatProvider>
        </KeyboardShortcutsProvider>
      </NotificationsProvider>
    </PermissionProvider>
  );
}
