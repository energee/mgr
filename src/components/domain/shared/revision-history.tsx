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

import { useMemo, useState } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { dynamicFrom } from "@/services/types";
import { revisionKeys } from "@/lib/query-keys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronRight, Plus, Pencil, Trash2 } from "lucide-react";
import {
  Timeline,
  TimelineItem,
  TimelineDot,
  TimelineConnector,
  TimelineContent,
} from "@/components/ui/timeline";


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

type Revision = {
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

type RevisionHistoryProps = {
  /** Entity type (table name) */
  entityType: string;
  /** Entity ID */
  entityId: string;
  /** Fields to exclude from diff display */
  excludeFields?: string[];
  /** Maximum revisions to show initially */
  maxInitial?: number;
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/**
 * Format a field name for display.
 * Strips `_id` suffix from FK fields so "yeast_id" becomes "Yeast".
 */
function formatFieldName(field: string): string {
  return field
    .replace(/_id$/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Format a value for display. Handles UUIDs, dates, arrays, and objects
 * to avoid showing raw technical data in the revision timeline.
 * When a resolvedNames map is provided, UUIDs are replaced with display names.
 */
function formatValue(value: unknown, resolvedNames?: Map<string, string>): string {
  if (value === null || value === undefined) {
    return "—";
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (typeof value === "string") {
    if (UUID_RE.test(value)) {
      return resolvedNames?.get(value) ?? "(reference)";
    }
    if (ISO_DATE_RE.test(value)) {
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
      }
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "Empty";
    return `${value.length} item${value.length !== 1 ? "s" : ""}`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.length === 0) return "Empty";
    return `${keys.length} field${keys.length !== 1 ? "s" : ""}`;
  }
  return String(value);
}

// =============================================================================
// FK Name Resolution
// =============================================================================

/** Maps FK field names to their lookup table. Covers irregular plurals
 *  and legacy columns whose tables were dropped during the containers migration. */
const FK_TABLE_MAP: Record<string, string> = {
  style_id: "beer_styles",
  yeast_id: "yeasts",
  pricing_tier_id: "pricing_tiers",
  selling_format_id: "selling_formats",
  container_id: "containers",
  keg_owner_id: "keg_owners",
  sales_channel_id: "sales_channels",
  delivery_id: "deliveries",
  category_id: "categories",
  batch_id: "batches",
  address_id: "addresses",
  inventory_id: "inventories",
  // Legacy columns -- old UUIDs were reused as selling_formats.id
  package_type_id: "selling_formats",
  keg_type_id: "selling_formats",
};

/** Derive the lookup table for a `_id` field. Uses FK_TABLE_MAP for exceptions,
 *  otherwise strips `_id` and appends `s` (e.g. `brand_id` → `brands`). */
function fkTable(field: string): string {
  if (FK_TABLE_MAP[field]) return FK_TABLE_MAP[field];
  return field.replace(/_id$/, "s");
}

/**
 * Collect all UUID values from `_id` fields across revisions, grouped by table.
 * Returns { tableName: Set<uuid> }.
 */
function collectFkUuids(revisions: Revision[]): Map<string, Set<string>> {
  const byTable = new Map<string, Set<string>>();
  for (const rev of revisions) {
    for (const data of [rev.old_data, rev.new_data]) {
      if (!data) continue;
      for (const [key, val] of Object.entries(data)) {
        if (key.endsWith("_id") && typeof val === "string" && UUID_RE.test(val)) {
          const table = fkTable(key);
          let set = byTable.get(table);
          if (!set) {
            set = new Set();
            byTable.set(table, set);
          }
          set.add(val);
        }
      }
    }
  }
  return byTable;
}

/**
 * Hook that resolves UUID foreign key values to display names.
 * Returns a Map<uuid, displayName>.
 */
function useResolvedNames(revisions: Revision[]): Map<string, string> {

  const fkGroups = useMemo(() => {
    const grouped = collectFkUuids(revisions);
    return Array.from(grouped.entries()).map(([table, ids]) => ({
      table,
      ids: Array.from(ids),
    }));
  }, [revisions]);

  const queries = useQueries({
    queries: fkGroups.map(({ table, ids }) => ({
      queryKey: revisionKeys.fkResolve(table, ids),
      queryFn: async () => {
        const { data } = await dynamicFrom(createClient(), table)
          .select("id, name")
          .in("id", ids);
        return (data ?? []) as Array<{ id: string; name: string }>;
      },
      staleTime: 5 * 60 * 1000,
    })),
  });

  return useMemo(() => {
    const map = new Map<string, string>();
    for (const q of queries) {
      if (q.data) {
        for (const row of q.data) {
          if (row.name) map.set(row.id, row.name);
        }
      }
    }
    return map;
  }, [queries]);
}

// =============================================================================
// Constants
// =============================================================================

const OPERATION_CONFIG = {
  INSERT: { icon: Plus, label: "Created", color: "bg-green-500" },
  UPDATE: { icon: Pencil, label: "Updated", color: "bg-blue-500" },
  DELETE: { icon: Trash2, label: "Deleted", color: "bg-red-500" },
} as const;

// =============================================================================
// Sub-components
// =============================================================================

function RevisionItem({
  revision,
  excludeFields,
  resolvedNames,
}: {
  revision: Revision;
  excludeFields: string[];
  resolvedNames: Map<string, string>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const changes = getChanges(revision.old_data, revision.new_data, excludeFields);

  const config = OPERATION_CONFIG[revision.operation];
  const Icon = config.icon;

  return (
    <TimelineItem className="pb-4 last:pb-0">
      <TimelineDot className={`border-0 ${config.color}`} />
      <TimelineConnector />
      <TimelineContent>
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
                          {formatValue(oldValue, resolvedNames)}
                        </span>
                      </div>
                    )}
                    {newValue !== null && (
                      <div className="flex gap-2">
                        <span className="text-green-600 dark:text-green-400">+</span>
                        <span>{formatValue(newValue, resolvedNames)}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </TimelineContent>
    </TimelineItem>
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
}: RevisionHistoryProps) {
  const [showAll, setShowAll] = useState(false);

  const { data: revisions = [], isLoading } = useQuery({
    queryKey: revisionKeys.forEntity(entityType, entityId),
    queryFn: async () => {
      const { data, error } = await dynamicFrom(createClient(), "entity_revisions")
        .select("*")
        .eq("entity_type", entityType)
        .eq("entity_id", entityId)
        .order("revision_number", { ascending: false });

      if (error) throw error;
      return data as Revision[];
    },
  });

  const resolvedNames = useResolvedNames(revisions);
  const displayedRevisions = showAll ? revisions : revisions.slice(0, maxInitial);
  const hasMore = revisions.length > maxInitial;

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4">
        {revisions.length} revision{revisions.length !== 1 ? "s" : ""}
      </p>
      {isLoading ? (
        <RevisionHistorySkeleton />
      ) : revisions.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          No revision history available
        </p>
      ) : (
        <>
          <Timeline className="gap-0">
            {displayedRevisions.map((revision) => (
              <RevisionItem
                key={revision.id}
                revision={revision}
                excludeFields={excludeFields}
                resolvedNames={resolvedNames}
              />
            ))}
          </Timeline>

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
    </div>
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
  const { data: revisions = [], isLoading } = useQuery({
    queryKey: revisionKeys.forEntityCompact(entityType, entityId),
    queryFn: async () => {
      const { data, error } = await dynamicFrom(createClient(), "entity_revisions")
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

  return (
    <div className="space-y-1.5">
      {revisions.map((rev: { id: string; operation: Revision["operation"]; changed_at: string; revision_number: number }) => (
        <div key={rev.id} className="flex items-center gap-2 text-sm">
          <Badge variant="outline" className="text-xs">
            {OPERATION_CONFIG[rev.operation].label}
          </Badge>
          <span className="text-muted-foreground">
            {formatTimeAgo(new Date(rev.changed_at))}
          </span>
        </div>
      ))}
    </div>
  );
}
