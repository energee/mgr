"use client";

/**
 * Notification Bell Component
 *
 * Displays notification bell icon with unread count badge.
 * Opens dropdown panel to view and manage notifications.
 */

import { useState } from "react";
import { Check, CheckCheck, X, ExternalLink } from "lucide-react";
import { AnimatedBell } from "@/components/icons/animated";
import type { AnimatedIconHandle } from "@/components/icons/animated";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useNotifications, type Notification } from "@/contexts/notifications";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { log } from "@/lib/client-logger";
import { RelativeTime } from "@/components/universal/relative-time";
import { formatDistanceToNow } from "date-fns";

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Format a date as a short relative-time label (e.g. "2m ago", "3h ago").
 *
 * Wraps `date-fns/formatDistanceToNow` with a project-specific compact suffix
 * style. Falls back to a locale date string for older timestamps to match
 * the prior hand-rolled behavior.
 */
function formatTimeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffDay = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDay >= 7) return date.toLocaleDateString();
  if (diffMs < 60_000) return "just now";
  return `${formatDistanceToNow(date)} ago`;
}

function getPriorityColor(priority: Notification["priority"]): string {
  switch (priority) {
    case "urgent":
      return "bg-red-500";
    case "high":
      return "bg-orange-500";
    case "normal":
      return "bg-blue-500";
    case "low":
      return "bg-gray-400";
    default:
      return "bg-gray-400";
  }
}

// =============================================================================
// Notification Item
// =============================================================================

type NotificationItemProps = {
  notification: Notification;
  onMarkAsRead: (id: string) => void;
  onDismiss: (id: string) => void;
  onClose: () => void;
}

function NotificationItem({
  notification,
  onMarkAsRead,
  onDismiss,
  onClose,
}: NotificationItemProps) {
  const handleClick = () => {
    if (notification.action_url) {
      onMarkAsRead(notification.id);
      onClose();
    }
  };

  const content = (
    <div
      className={cn(
        "group relative flex gap-3 p-3 hover:bg-muted/50 transition-colors",
        "border-b border-border last:border-b-0"
      )}
    >
      {/* Priority indicator */}
      <div
        className={cn(
          "w-2 h-2 rounded-full mt-2 flex-shrink-0",
          getPriorityColor(notification.priority)
        )}
        aria-hidden="true"
      />
      <span className="sr-only">{notification.priority} priority</span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-sm font-medium text-foreground line-clamp-1">
            {notification.title}
          </h4>
          {/* Audit F-091: render relative time on the client to avoid SSR mismatch. */}
          <RelativeTime
            value={notification.created_at}
            format={formatTimeAgo}
            className="text-xs text-muted-foreground whitespace-nowrap"
          />
        </div>
        {notification.message && (
          <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
            {notification.message}
          </p>
        )}
        {notification.action_url && (
          <div className="flex items-center gap-1 mt-1 text-xs text-primary">
            <ExternalLink className="h-3 w-3" />
            <span>View details</span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-start gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onMarkAsRead(notification.id);
          }}
          aria-label="Mark as read"
        >
          <Check className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDismiss(notification.id);
          }}
          aria-label="Dismiss"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );

  if (notification.action_url) {
    return (
      <Link href={notification.action_url} onClick={handleClick}>
        {content}
      </Link>
    );
  }

  return content;
}

// =============================================================================
// Notification Bell
// =============================================================================

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const {
    notifications,
    unreadCount,
    isLoading,
    markAsRead,
    markAllAsRead,
    dismiss,
  } = useNotifications();

  const handleMarkAsRead = async (id: string) => {
    try {
      await markAsRead(id);
    } catch (error) {
      log.error("Failed to mark notification as read:", error);
    }
  };

  const handleDismiss = async (id: string) => {
    try {
      await dismiss(id);
    } catch (error) {
      log.error("Failed to dismiss notification:", error);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await markAllAsRead();
    } catch (error) {
      log.error("Failed to mark all notifications as read:", error);
    }
  };

  const bellRef = useRef<AnimatedIconHandle>(null);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
          onMouseEnter={() => bellRef.current?.startAnimation()}
          onMouseLeave={() => bellRef.current?.stopAnimation()}
        >
          <AnimatedBell ref={bellRef} className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[380px] p-0"
        align="end"
        sideOffset={8}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-foreground">Notifications</h3>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={handleMarkAllAsRead}
            >
              <CheckCheck className="h-3 w-3 mr-1" />
              Mark all read
            </Button>
          )}
        </div>

        {/* Content */}
        <div className="max-h-[400px] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              Loading...
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <AnimatedBell className="h-8 w-8 mb-2 opacity-50" aria-hidden="true" />
              <p className="text-sm">No notifications</p>
            </div>
          ) : (
            <div>
              {notifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onMarkAsRead={handleMarkAsRead}
                  onDismiss={handleDismiss}
                  onClose={() => setOpen(false)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-4 py-2 flex items-center justify-between">
          <Link
            href="/notifications"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setOpen(false)}
          >
            View all notifications
          </Link>
          <Link
            href="/settings/notifications"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setOpen(false)}
          >
            Settings
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
