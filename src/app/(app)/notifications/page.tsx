"use client";

/**
 * Notifications History Page
 *
 * Full list of all notifications with filtering and bulk actions.
 * Shows read and unread notifications with search and filter capabilities.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { notificationKeys } from "@/lib/query-keys";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Bell,
  Check,
  Trash2,
  ExternalLink,
  Search,
  Settings,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { cn, escapeLike } from "@/lib/utils";
import { dynamicFrom, dynamicRpc } from "@/services/types";
import { RelativeTime } from "@/components/universal/relative-time";

// =============================================================================
// Types
// =============================================================================

type Notification = {
  id: string;
  type: string;
  title: string;
  message: string | null;
  entity_type: string | null;
  entity_id: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  action_url: string | null;
  read_at: string | null;
  dismissed_at: string | null;
  created_at: string;
}

// =============================================================================
// Constants
// =============================================================================

/** Domain constants: notification priority dot colors (not entity status -- no stateMachine applies). */
const PRIORITY_COLORS: Record<string, string> = {
  urgent: "bg-red-500",
  high: "bg-orange-500",
  normal: "bg-blue-500",
  low: "bg-gray-400",
};

/** Domain constants: notification priority badge variants (not entity status). */
const PRIORITY_BADGE_VARIANTS: Record<string, "destructive" | "default" | "secondary" | "outline"> = {
  urgent: "destructive",
  high: "default",
  normal: "secondary",
  low: "outline",
};

/** Domain constants: notification type labels (not entity status -- no stateMachine applies). */
const TYPE_LABELS: Record<string, string> = {
  batch_status: "Batch Status",
  order_status: "Order Status",
  new_order: "New Order",
  po_status: "Purchase Order",
  packaging_complete: "Packaging",
  low_inventory: "Low Inventory",
  system: "System",
};

const PAGE_SIZE = 20;

// =============================================================================
// Helper Functions
// =============================================================================

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: "long" });
  } else {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }
}

// =============================================================================
// Component
// =============================================================================

export default function NotificationsPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  // State
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);

  // Fetch all notifications
  const { data, isLoading, error } = useQuery({
    queryKey: notificationKeys.list({ page, filterType, filterStatus, filterPriority, search }),
    queryFn: async () => {
      let query = dynamicFrom(supabase, "notifications")
        .select("*", { count: "exact" })
        .is("dismissed_at", null)
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      // Apply filters
      if (filterType !== "all") {
        query = query.eq("type", filterType);
      }
      if (filterStatus === "unread") {
        query = query.is("read_at", null);
      } else if (filterStatus === "read") {
        query = query.not("read_at", "is", null);
      }
      if (filterPriority !== "all") {
        query = query.eq("priority", filterPriority);
      }
      if (search) {
        const escaped = escapeLike(search);
        query = query.or(`title.ilike.%${escaped}%,message.ilike.%${escaped}%`);
      }

      const { data, error, count } = await query;
      if (error) throw error;

      return {
        notifications: data as Notification[],
        totalCount: count || 0,
      };
    },
  });

  const notifications = data?.notifications || [];
  const totalCount = data?.totalCount || 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  // Mark as read mutation - uses RPC function for consistency with NotificationsProvider
  const markAsReadMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      // Call RPC for each notification (RPC handles single IDs)
      const results = await Promise.all(
        ids.map((id) =>
          dynamicRpc(supabase, "mark_notification_read", { p_notification_id: id })
        )
      );
      const error = results.find((r) => r.error)?.error;
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.all() });
      setSelectedIds(new Set());
      toast.success("Marked as read");
    },
    onError: () => {
      toast.error("Failed to mark as read");
    },
  });

  // Dismiss mutation - uses RPC function for consistency with NotificationsProvider
  const dismissMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      // Call RPC for each notification (RPC handles single IDs)
      const results = await Promise.all(
        ids.map((id) =>
          dynamicRpc(supabase, "dismiss_notification", { p_notification_id: id })
        )
      );
      const error = results.find((r) => r.error)?.error;
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.all() });
      setSelectedIds(new Set());
      toast.success("Notifications dismissed");
    },
    onError: () => {
      toast.error("Failed to dismiss notifications");
    },
  });

  // Selection handlers
  const toggleSelection = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === notifications.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(notifications.map((n) => n.id)));
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="text-muted-foreground">
            View and manage your notification history
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/settings/notifications">
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </Link>
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search notifications..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
                className="pl-9"
              />
            </div>

            {/* Type filter */}
            <Select
              value={filterType}
              onValueChange={(value) => {
                setFilterType(value);
                setPage(0);
              }}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {Object.entries(TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Status filter */}
            <Select
              value={filterStatus}
              onValueChange={(value) => {
                setFilterStatus(value);
                setPage(0);
              }}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="All status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="unread">Unread</SelectItem>
                <SelectItem value="read">Read</SelectItem>
              </SelectContent>
            </Select>

            {/* Priority filter */}
            <Select
              value={filterPriority}
              onValueChange={(value) => {
                setFilterPriority(value);
                setPage(0);
              }}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="All priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All priority</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Bulk actions */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
          <span className="text-sm font-medium">
            {selectedIds.size} selected
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => markAsReadMutation.mutate(Array.from(selectedIds))}
            disabled={markAsReadMutation.isPending}
          >
            <Check className="h-4 w-4 mr-1" />
            Mark as read
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => dismissMutation.mutate(Array.from(selectedIds))}
            disabled={dismissMutation.isPending}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Dismiss
          </Button>
        </div>
      )}

      {/* Notifications list */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-medium">
              {totalCount} notification{totalCount !== 1 ? "s" : ""}
            </CardTitle>
            {notifications.length > 0 && (
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={
                    selectedIds.size === notifications.length &&
                    notifications.length > 0
                  }
                  onCheckedChange={toggleSelectAll}
                />
                <span className="text-sm text-muted-foreground">Select all</span>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              Loading...
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-12 text-destructive">
              Failed to load notifications
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Bell className="h-12 w-12 mb-4 opacity-50" />
              <p className="text-lg font-medium">No notifications</p>
              <p className="text-sm">
                {search || filterType !== "all" || filterStatus !== "all"
                  ? "Try adjusting your filters"
                  : "You're all caught up!"}
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={cn(
                    "flex items-start gap-4 p-4 hover:bg-muted/50 transition-colors",
                    !notification.read_at && "bg-muted/30"
                  )}
                >
                  {/* Checkbox */}
                  <Checkbox
                    checked={selectedIds.has(notification.id)}
                    onCheckedChange={() => toggleSelection(notification.id)}
                    className="mt-1"
                  />

                  {/* Priority indicator */}
                  <div
                    className={cn(
                      "w-2 h-2 rounded-full mt-2 flex-shrink-0",
                      PRIORITY_COLORS[notification.priority]
                    )}
                    title={`${notification.priority} priority`}
                  >
                    <span className="sr-only">{notification.priority} priority</span>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <h4
                          className={cn(
                            "text-sm line-clamp-1",
                            !notification.read_at && "font-semibold"
                          )}
                        >
                          {notification.title}
                        </h4>
                        <Badge
                          variant={PRIORITY_BADGE_VARIANTS[notification.priority]}
                          className="text-[10px] px-1.5 py-0"
                        >
                          {notification.priority}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {TYPE_LABELS[notification.type] || notification.type}
                        </Badge>
                      </div>
                      {/* Audit F-091: render relative time on the client to avoid SSR mismatch. */}
                      <RelativeTime
                        value={notification.created_at}
                        format={(d) => formatDate(d.toISOString())}
                        className="text-xs text-muted-foreground whitespace-nowrap"
                      />
                    </div>
                    {notification.message && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {notification.message}
                      </p>
                    )}
                    {notification.action_url && (
                      <Link
                        href={notification.action_url}
                        className="inline-flex items-center gap-1 mt-2 text-xs text-primary hover:underline"
                        onClick={() => {
                          if (!notification.read_at) {
                            markAsReadMutation.mutate([notification.id]);
                          }
                        }}
                      >
                        <ExternalLink className="h-3 w-3" />
                        View details
                      </Link>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1">
                    {!notification.read_at && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => markAsReadMutation.mutate([notification.id])}
                        title="Mark as read"
                        aria-label="Mark as read"
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => dismissMutation.mutate([notification.id])}
                      title="Dismiss"
                      aria-label="Dismiss notification"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {page * PAGE_SIZE + 1} -{" "}
            {Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
