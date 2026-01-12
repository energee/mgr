"use client";

/**
 * RevisionHistory - Entity Audit Trail Component
 *
 * Displays the revision history for an entity, showing:
 * - Timeline of changes
 * - What changed (diff view)
 * - Who made the change
 * - When the change occurred
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { ChevronDown, ChevronRight, History, Plus, Pencil, Trash2 } from "lucide-react";

/**
 * Format a date as relative time (e.g., "2 hours ago", "3 days ago").
 */
function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return "just now";
  } else if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes !== 1 ? "s" : ""} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
  } else if (diffDays < 30) {
    return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
  } else {
    return date.toLocaleDateString();
  }
}

// =============================================================================
// Types
// =============================================================================

interface Revision {
  id: string;
  entity_type: string;
  entity_id: string;
  revision_number: number;
  operation: "INSERT" | "UPDATE" | "DELETE";
  changed_by: string | null;
  changed_at: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  change_reason: string | null;
}

interface RevisionHistoryProps {
  /** Entity type (table name) */
  entityType: string;
  /** Entity ID */
  entityId: string;
  /** Fields to exclude from diff display */
  excludeFields?: string[];
  /** Maximum revisions to show initially */
  maxInitial?: number;
  /** Title override */
  title?: string;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get changes between old and new data.
 */
function getChanges(
  oldData: Record<string, unknown> | null,
  newData: Record<string, unknown> | null,
  excludeFields: string[] = []
): Array<{ field: string; oldValue: unknown; newValue: unknown }> {
  const defaultExclude = ["id", "created_at", "updated_at", "created_by", "updated_by"];
  const exclude = new Set([...defaultExclude, ...excludeFields]);

  const changes: Array<{ field: string; oldValue: unknown; newValue: unknown }> = [];

  // Handle INSERT (no old data)
  if (!oldData && newData) {
    for (const [key, value] of Object.entries(newData)) {
      if (!exclude.has(key) && value !== null && value !== "") {
        changes.push({ field: key, oldValue: null, newValue: value });
      }
    }
    return changes;
  }

  // Handle DELETE (no new data)
  if (oldData && !newData) {
    for (const [key, value] of Object.entries(oldData)) {
      if (!exclude.has(key) && value !== null && value !== "") {
        changes.push({ field: key, oldValue: value, newValue: null });
      }
    }
    return changes;
  }

  // Handle UPDATE
  if (oldData && newData) {
    const allKeys = new Set([...Object.keys(oldData), ...Object.keys(newData)]);
    for (const key of allKeys) {
      if (exclude.has(key)) continue;
      const oldValue = oldData[key];
      const newValue = newData[key];
      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        changes.push({ field: key, oldValue, newValue });
      }
    }
  }

  return changes;
}

/**
 * Format a field name for display.
 */
function formatFieldName(field: string): string {
  return field
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Format a value for display.
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "—";
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

// =============================================================================
// Sub-components
// =============================================================================

function RevisionItem({
  revision,
  excludeFields,
}: {
  revision: Revision;
  excludeFields: string[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const changes = getChanges(revision.old_data, revision.new_data, excludeFields);

  const operationConfig = {
    INSERT: { icon: Plus, label: "Created", color: "bg-green-500" },
    UPDATE: { icon: Pencil, label: "Updated", color: "bg-blue-500" },
    DELETE: { icon: Trash2, label: "Deleted", color: "bg-red-500" },
  };

  const config = operationConfig[revision.operation];
  const Icon = config.icon;

  return (
    <div className="relative pl-6">
      {/* Timeline line */}
      <div className="absolute left-0 top-0 bottom-0 w-px bg-border" />

      {/* Timeline dot */}
      <div
        className={`absolute left-0 top-2 w-2 h-2 rounded-full -translate-x-1/2 ${config.color}`}
      />

      <div>
        <div className="flex items-start gap-2 py-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-auto p-1"
            onClick={() => setIsOpen(!isOpen)}
          >
            {isOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="gap-1">
                <Icon className="h-3 w-3" />
                {config.label}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {formatTimeAgo(new Date(revision.changed_at))}
              </span>
              {revision.change_reason && (
                <span className="text-sm text-muted-foreground">
                  — {revision.change_reason}
                </span>
              )}
            </div>
            {!isOpen && changes.length > 0 && (
              <p className="text-sm text-muted-foreground mt-1 truncate">
                {changes.length} field{changes.length !== 1 ? "s" : ""} changed
              </p>
            )}
          </div>

          <span className="text-xs text-muted-foreground">
            Rev #{revision.revision_number}
          </span>
        </div>

        {isOpen && (
          <div className="ml-6 mb-4 space-y-2">
            {changes.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No field changes</p>
            ) : (
              changes.map(({ field, oldValue, newValue }) => (
                <div
                  key={field}
                  className="text-sm border rounded-md p-2 bg-muted/50"
                >
                  <span className="font-medium">{formatFieldName(field)}</span>
                  <div className="flex flex-col gap-1 mt-1">
                    {oldValue !== null && (
                      <div className="flex gap-2">
                        <span className="text-red-600 dark:text-red-400">−</span>
                        <span className="text-muted-foreground line-through">
                          {formatValue(oldValue)}
                        </span>
                      </div>
                    )}
                    {newValue !== null && (
                      <div className="flex gap-2">
                        <span className="text-green-600 dark:text-green-400">+</span>
                        <span>{formatValue(newValue)}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function RevisionHistorySkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-start gap-2 pl-6">
          <Skeleton className="h-6 w-6" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
      ))}
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function RevisionHistory({
  entityType,
  entityId,
  excludeFields = [],
  maxInitial = 5,
  title = "Revision History",
}: RevisionHistoryProps) {
  const [showAll, setShowAll] = useState(false);
  const supabase = createClient();

  // Cast supabase for dynamic table access (entity_revisions not in types yet)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: revisions = [], isLoading } = useQuery({
    queryKey: ["entity_revisions", entityType, entityId],
    queryFn: async () => {
      const { data, error } = await db
        .from("entity_revisions")
        .select("*")
        .eq("entity_type", entityType)
        .eq("entity_id", entityId)
        .order("revision_number", { ascending: false });

      if (error) throw error;
      return data as Revision[];
    },
  });

  const displayedRevisions = showAll ? revisions : revisions.slice(0, maxInitial);
  const hasMore = revisions.length > maxInitial;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <History className="h-5 w-5" />
          {title}
        </CardTitle>
        <CardDescription>
          {revisions.length} revision{revisions.length !== 1 ? "s" : ""}
        </CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="pt-4">
        {isLoading ? (
          <RevisionHistorySkeleton />
        ) : revisions.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No revision history available
          </p>
        ) : (
          <>
            <div className="space-y-1">
              {displayedRevisions.map((revision) => (
                <RevisionItem
                  key={revision.id}
                  revision={revision}
                  excludeFields={excludeFields}
                />
              ))}
            </div>

            {hasMore && !showAll && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAll(true)}
                className="mt-4 w-full"
              >
                Show {revisions.length - maxInitial} more revision
                {revisions.length - maxInitial !== 1 ? "s" : ""}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Compact revision history for embedding in detail sections.
 */
export function RevisionHistoryCompact({
  entityType,
  entityId,
  limit = 3,
}: {
  entityType: string;
  entityId: string;
  limit?: number;
}) {
  const supabase = createClient();

  // Cast supabase for dynamic table access (entity_revisions not in types yet)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: revisions = [], isLoading } = useQuery({
    queryKey: ["entity_revisions", entityType, entityId, "compact"],
    queryFn: async () => {
      const { data, error } = await db
        .from("entity_revisions")
        .select("id, operation, changed_at, revision_number")
        .eq("entity_type", entityType)
        .eq("entity_id", entityId)
        .order("revision_number", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data;
    },
  });

  if (isLoading) {
    return <Skeleton className="h-16 w-full" />;
  }

  if (revisions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No revision history</p>
    );
  }

  const operationLabels = {
    INSERT: "Created",
    UPDATE: "Updated",
    DELETE: "Deleted",
  };

  return (
    <div className="space-y-1.5">
      {revisions.map((rev: { id: string; operation: string; changed_at: string; revision_number: number }) => (
        <div key={rev.id} className="flex items-center gap-2 text-sm">
          <Badge variant="outline" className="text-xs">
            {operationLabels[rev.operation as keyof typeof operationLabels]}
          </Badge>
          <span className="text-muted-foreground">
            {formatTimeAgo(new Date(rev.changed_at))}
          </span>
        </div>
      ))}
    </div>
  );
}
