"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";

import type { EntityConfig, KanbanCardField } from "@/types/entity";
import { getStateLabel } from "@/types/entity";
import {
  Kanban as KanbanBase,
  KanbanBoard,
  KanbanColumn,
  KanbanItem,
  KanbanOverlay,
} from "@/components/ui/kanban";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// KanbanProps<T> uses a conditional type `(T extends object ? GetItemValue<T> : ...)` that TypeScript
// can't resolve with unresolved generics. ComponentType<any> is the only way to use it in EntityKanban<T>.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Kanban = KanbanBase as React.ComponentType<any>;

// =============================================================================
// Types
// =============================================================================

type EntityKanbanProps<T = Record<string, unknown>> = {
  entity: EntityConfig<T>;
  data: T[];
  basePath: string;
  onTransition: (id: string, toState: string) => Promise<void>;
}

// Helper to extract string id from any record
function getRecordId(item: Record<string, unknown>): string {
  return String((item as Record<string, unknown>).id ?? "");
}

// =============================================================================
// Helpers
// =============================================================================

// Deliberately NOT `lib/format`'s `formatValue`: cards use a compact
// "MMM d, yyyy" date and "-" for blanks, where formatValue renders "1/5/2026"
// and "—". Same shape, different output — merging would change every card.
function formatCardFieldValue(
  value: unknown,
  fieldFormat?: KanbanCardField<Record<string, unknown>>["format"],
): string {
  if (value == null || value === "") return "-";

  switch (fieldFormat) {
    case "date":
      try {
        return format(parseISO(String(value)), "MMM d, yyyy");
      } catch {
        return String(value);
      }
    case "datetime":
      try {
        return format(parseISO(String(value)), "MMM d, yyyy h:mm a");
      } catch {
        return String(value);
      }
    case "number":
      return Number(value).toLocaleString();
    default:
      return String(value);
  }
}

// =============================================================================
// Card Content Component
// =============================================================================

function KanbanCardContent<T = Record<string, unknown>>({
  item,
  entity,
  onClick,
}: {
  item: T;
  entity: EntityConfig<T>;
  onClick?: () => void;
}) {
  const kanbanConfig = entity.kanbanConfig;
  if (!kanbanConfig) return null;

  const record = item as Record<string, unknown>;
  const title = record[kanbanConfig.titleField as string];
  const subtitle = kanbanConfig.subtitleField
    ? record[kanbanConfig.subtitleField as string]
    : null;
  const cardFields = kanbanConfig.cardFields ?? [];

  return (
    <div
      role="button"
      tabIndex={0}
      className="bg-card rounded-md border p-3 shadow-sm cursor-pointer hover:border-primary/50 transition-colors"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
    >
      <div className="font-medium text-sm truncate">
        {title != null ? String(title) : "-"}
      </div>
      {subtitle != null && (
        <div className="text-muted-foreground text-xs truncate mt-0.5">
          {String(subtitle)}
        </div>
      )}
      {cardFields.length > 0 && (
        <div className="text-xs text-muted-foreground mt-2 space-y-1">
          {cardFields.map((field) => (
            <div key={String(field.field)} className="flex justify-between">
              <span>{field.label}</span>
              <span className="font-medium text-foreground/70">
                {formatCardFieldValue(
                  record[field.field as string],
                  field.format,
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

function EntityKanban<T = Record<string, unknown>>({
  entity,
  data,
  basePath,
  onTransition,
}: EntityKanbanProps<T>) {
  const router = useRouter();
  const stateMachine = entity.stateMachine;
  const kanbanConfig = entity.kanbanConfig;

  // Track the original column of the currently dragged item
  const dragOriginColumnRef = React.useRef<string | null>(null);
  const draggedItemIdRef = React.useRef<string | null>(null);

  // Determine visible states (exclude configured states)
  const visibleStates = React.useMemo(() => {
    if (!stateMachine) return [];
    const excludeStates = new Set(kanbanConfig?.excludeStates ?? []);
    return stateMachine.states.filter((s) => !excludeStates.has(s));
  }, [stateMachine, kanbanConfig]);

  // Group data by state field into columns
  const groupedData = React.useMemo(() => {
    if (!stateMachine) return {};
    const stateField = stateMachine.stateField as string;
    const columns: Record<string, T[]> = {};

    // Initialize all visible states with empty arrays
    for (const state of visibleStates) {
      columns[state] = [];
    }

    // Distribute data into columns
    for (const item of data) {
      const state = String((item as Record<string, unknown>)[stateField] ?? "");
      if (columns[state]) {
        columns[state].push(item);
      }
    }

    return columns;
  }, [data, stateMachine, visibleStates]);

  // Controlled columns state
  const [columns, setColumns] = React.useState(groupedData);

  // Sync columns when external data changes
  React.useEffect(() => {
    setColumns(groupedData);
  }, [groupedData]);

  // Find which column an item is in
  const findItemColumn = React.useCallback(
    (itemId: string, cols: Record<string, T[]>): string | null => {
      for (const [colId, items] of Object.entries(cols)) {
        if (items.some((item) => getRecordId(item as Record<string, unknown>) === itemId)) {
          return colId;
        }
      }
      return null;
    },
    [],
  );

  // Handle value change from Kanban (called during drag-over for cross-column moves)
  const handleValueChange = React.useCallback(
    (newColumns: Record<string, T[]>) => {
      if (!stateMachine || !draggedItemIdRef.current) {
        setColumns(newColumns as Record<string, T[]>);
        return;
      }

      const itemId = draggedItemIdRef.current;
      const fromState = dragOriginColumnRef.current;
      const toState = findItemColumn(itemId, newColumns);

      // Same column reorder - always allow
      if (!fromState || !toState || fromState === toState) {
        setColumns(newColumns as Record<string, T[]>);
        return;
      }

      // Cross-column move: validate transition
      const allowedTransitions = stateMachine.transitions[fromState] ?? [];
      if (!allowedTransitions.includes(toState)) {
        // Invalid transition - silently reject visual move (toast shown on drop)
        return;
      }

      // Valid transition - allow the visual move
      setColumns(newColumns as Record<string, T[]>);
    },
    [stateMachine, findItemColumn],
  );

  // Handle drag start - track origin column (use groupedData for stable pre-drag state)
  const handleDragStart = React.useCallback(
    (event: { active: { id: string | number } }) => {
      const itemId = String(event.active.id);
      draggedItemIdRef.current = itemId;
      dragOriginColumnRef.current = findItemColumn(itemId, groupedData);
    },
    [groupedData, findItemColumn],
  );

  // Handle drag end - fire transition if item moved to a new valid column
  const handleDragEnd = React.useCallback(
    (event: { active: { id: string | number } }) => {
      const itemId = String(event.active.id);
      const fromState = dragOriginColumnRef.current;
      const toState = findItemColumn(itemId, columns);

      // Clean up refs
      draggedItemIdRef.current = null;
      dragOriginColumnRef.current = null;

      if (!fromState || !toState || fromState === toState) return;
      if (!stateMachine) return;

      // Validate transition
      const allowedTransitions = stateMachine.transitions[fromState] ?? [];
      if (!allowedTransitions.includes(toState)) {
        const fromLabel = getStateLabel(entity, fromState);
        const toLabel = getStateLabel(entity, toState);
        toast.error(`Cannot move from "${fromLabel}" to "${toLabel}"`);
        setColumns(groupedData);
        return;
      }

      // Fire the transition
      onTransition(itemId, toState).catch(() => {
        setColumns(groupedData);
        toast.error("Failed to update status");
      });
    },
    [columns, findItemColumn, stateMachine, entity, onTransition, groupedData],
  );

  // Handle drag cancel - revert to prop-driven state
  const handleDragCancel = React.useCallback(() => {
    draggedItemIdRef.current = null;
    dragOriginColumnRef.current = null;
    setColumns(groupedData);
  }, [groupedData]);

  if (!stateMachine || !kanbanConfig) {
    return (
      <div className="text-muted-foreground text-sm p-4">
        Kanban view requires a state machine and kanban configuration.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Kanban
        value={columns}
        onValueChange={handleValueChange}
        getItemValue={(item: T) => getRecordId(item as Record<string, unknown>)}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <KanbanBoard>
          {visibleStates.map((state) => {
            const items = columns[state] ?? [];
            return (
              <KanbanColumn
                key={state}
                value={state}
                className={cn(
                  "bg-muted/50 rounded-lg transition-all",
                  items.length > 0
                    ? "flex-1 min-w-[180px] p-3"
                    : "w-[60px] min-w-[60px] p-2",
                )}
              >
                {/* Column Header */}
                {items.length > 0 ? (
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-medium text-sm">
                      {getStateLabel(entity, state)}
                    </span>
                    <Badge variant="secondary">{items.length}</Badge>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-1">
                    <span className="font-medium text-xs text-muted-foreground [writing-mode:vertical-lr] rotate-180">
                      {getStateLabel(entity, state)}
                    </span>
                  </div>
                )}

                {/* Cards */}
                {items.map((item) => {
                  const itemId = getRecordId(item as Record<string, unknown>);
                  return (
                    <KanbanItem key={itemId} value={itemId} asHandle>
                      <KanbanCardContent
                        item={item}
                        entity={entity}
                        onClick={() => router.push(`${basePath}/${itemId}`)}
                      />
                    </KanbanItem>
                  );
                })}
              </KanbanColumn>
            );
          })}
        </KanbanBoard>

        {/* Overlay for drag preview */}
        <KanbanOverlay>
          {({ value: activeId }) => {
            // Find the item being dragged
            for (const items of Object.values(columns)) {
              const item = items.find((i) => getRecordId(i as Record<string, unknown>) === String(activeId));
              if (item) {
                return (
                  <KanbanCardContent
                    item={item}
                    entity={entity}
                  />
                );
              }
            }
            return null;
          }}
        </KanbanOverlay>
      </Kanban>
    </div>
  );
}

export { EntityKanban, type EntityKanbanProps };
