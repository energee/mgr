"use client";

/**
 * App Providers
 *
 * Client providers for authenticated app routes.
 * Includes notifications, keyboard shortcuts, and other authenticated-only contexts.
 *
 * QueryClientProvider is co-located here (not relied on from the root Providers)
 * because async RSC layouts + Turbopack dev mode can process this client subtree
 * before the root Providers context is established, causing useQueryClient() to
 * throw "No QueryClient set" inside NotificationsProvider (MGR-8).
 *
 * Dual-cache note: the root Providers still has its own QueryClientProvider for
 * portal routes. App-route components use THIS inner client (TanStack inner-takes-
 * precedence rule). Do NOT prefetch into the outer client expecting app components
 * to see it — they won't.
 */

import { type ReactNode, useState, useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { NotificationsProvider } from "@/contexts/notifications";
import { PermissionProvider } from "@/contexts/permissions";
import { KeyboardShortcutsProvider } from "@/components/domain/shared/keyboard-shortcuts-provider";
import { ChatProvider } from "@/contexts/chat-context";
import { createClient } from "@/lib/supabase/client";
import type { UserRole } from "@/lib/permissions";
import { log } from "@/lib/client-logger";
import { createAppQueryClient } from "@/lib/query-client";

type AppProvidersProps = {
  roles: UserRole[];
  children: ReactNode;
}

export function AppProviders({ roles, children }: AppProvidersProps) {
  const [queryClient] = useState(createAppQueryClient);

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
    <QueryClientProvider client={queryClient}>
      <PermissionProvider roles={roles}>
        <NotificationsProvider>
          <KeyboardShortcutsProvider>
            <ChatProvider>{children}</ChatProvider>
          </KeyboardShortcutsProvider>
        </NotificationsProvider>
      </PermissionProvider>
    </QueryClientProvider>
  );
}
