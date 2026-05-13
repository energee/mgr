"use client";

/**
 * Notifications Context
 *
 * Provides real-time notification functionality:
 * - Subscribes to new notifications via Supabase Realtime
 * - Manages unread count
 * - Mark as read/dismiss functionality
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useCallback,
  type ReactNode,
} from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { dynamicFrom, dynamicRpc } from "@/services/types";
import { notificationKeys } from "@/lib/query-keys";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { toast } from "sonner";
import { log } from "@/lib/client-logger";

// =============================================================================
// Types
// =============================================================================

export type Notification = {
  id: string;
  type: string;
  title: string;
  message: string | null;
  entity_type: string | null;
  entity_id: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  action_url: string | null;
  metadata: Record<string, unknown>;
  is_read?: boolean;
  read_at?: string | null;
  created_at: string;
}

type NotificationsContextValue = {
  /** List of unread notifications */
  notifications: Notification[];
  /** Number of unread notifications */
  unreadCount: number;
  /** Whether notifications are loading */
  isLoading: boolean;
  /** Mark a notification as read */
  markAsRead: (id: string) => Promise<void>;
  /** Mark all notifications as read */
  markAllAsRead: () => Promise<void>;
  /** Dismiss a notification */
  dismiss: (id: string) => Promise<void>;
  /** Refresh notifications */
  refetch: () => void;
}

// =============================================================================
// Context
// =============================================================================

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

type NotificationsProviderProps = {
  children: ReactNode;
}

export function NotificationsProvider({ children }: NotificationsProviderProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  // Fetch unread notifications
  const {
    data: notifications = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: notificationKeys.unread(),
    queryFn: async () => {
      // View not yet in generated types — use dynamicFrom for runtime table access
      const { data, error } = await dynamicFrom(supabase, "my_unread_notifications")
        .select("*")
        .limit(50);

      if (error) {
        log.error("Failed to fetch notifications:", error.message, error.code, error.details);
        return [];
      }

      return data as Notification[];
    },
    // Refetch periodically as backup to realtime
    refetchInterval: 60000,
  });

  // Set up realtime subscription
  useEffect(() => {
    // Local variable captures the channel so cleanup can reference it
    // (state setter alone would leave the cleanup closure with a stale null)
    let activeChannel: RealtimeChannel | null = null;

    const setupRealtime = async () => {
      // Get current user
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      // Subscribe to notifications for this user
      const newChannel = supabase
        .channel(`notifications:${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            // Add new notification to the list
            const newNotification = payload.new as Notification;

            // Show toast for high priority notifications
            if (newNotification.priority === "high" || newNotification.priority === "urgent") {
              toast(newNotification.title, {
                description: newNotification.message || undefined,
              });
            }

            // Refetch to update the list
            queryClient.invalidateQueries({ queryKey: notificationKeys.unread() });
          }
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${user.id}`,
          },
          () => {
            // Notification was read/dismissed, refetch
            queryClient.invalidateQueries({ queryKey: notificationKeys.unread() });
          }
        )
        .subscribe();

      activeChannel = newChannel;
    };

    setupRealtime();

    // Cleanup on unmount — uses local activeChannel, not stale state
    return () => {
      if (activeChannel) {
        supabase.removeChannel(activeChannel);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once realtime subscription; supabase/queryClient are stable singletons
  }, []);

  // Mark as read mutation
  const markAsReadMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await dynamicRpc(supabase, "mark_notification_read", {
        p_notification_id: id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.unread() });
    },
  });

  // Mark all as read mutation
  const markAllAsReadMutation = useMutation({
    mutationFn: async () => {
      const { error } = await dynamicRpc(supabase, "mark_all_notifications_read");
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.unread() });
    },
  });

  // Dismiss mutation
  const dismissMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await dynamicRpc(supabase, "dismiss_notification", {
        p_notification_id: id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.unread() });
    },
  });

  const markAsRead = useCallback(
    async (id: string) => {
      await markAsReadMutation.mutateAsync(id);
    },
    [markAsReadMutation]
  );

  const markAllAsRead = useCallback(async () => {
    await markAllAsReadMutation.mutateAsync();
  }, [markAllAsReadMutation]);

  const dismiss = useCallback(
    async (id: string) => {
      await dismissMutation.mutateAsync(id);
    },
    [dismissMutation]
  );

  // Memoize the context value so consumers don't re-render on unrelated
  // provider re-renders (audit finding F-141). Previously this object was
  // reconstructed every render, breaking referential equality for every
  // useContext(NotificationsContext) consumer in the tree.
  const value = useMemo<NotificationsContextValue>(
    () => ({
      notifications,
      unreadCount: notifications.length,
      isLoading,
      markAsRead,
      markAllAsRead,
      dismiss,
      refetch,
    }),
    [notifications, isLoading, markAsRead, markAllAsRead, dismiss, refetch],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

// =============================================================================
// Hook
// =============================================================================

export function useNotifications() {
  const context = useContext(NotificationsContext);
  if (!context) {
    throw new Error("useNotifications must be used within a NotificationsProvider");
  }
  return context;
}
